/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { NavContextMenuPatchCallback } from "@api/ContextMenu";
import { EquicordDevs } from "@utils/constants";
import definePlugin from "@utils/types";
import { User } from "@vencord/discord-types";
import { GuildMemberStore, LocaleStore, Menu, openModal, RelationshipStore, UsernameUtils, UserStore } from "@webpack/common";

import { NicknameList, NicknameModal, NicknameProfileSection } from "./components";
import { clearNickname, getNickname, getNicknameMapRef, invalidateNicknameCache, settings } from "./settings";
import { NicknameMap, pickStrings, withMemberNick } from "./utils";

type AnyFn = (...args: any[]) => any;

/**
 * getMember runs constantly while rendering, so returning a new object every time would
 * break reference equality and defeat memoisation. Keyed by the original member, which
 * Discord replaces whenever the member actually changes, so stale copies fall out on
 * their own.
 */
const memberNickCache = new WeakMap<object, { nickname: string; copy: any; }>();

function getMemberWithNick(member: any, nickname: string): any {
    const cached = memberNickCache.get(member);
    if (cached && cached.nickname === nickname) return cached.copy;

    const copy = withMemberNick(member, nickname);
    memberNickCache.set(member, { nickname, copy });
    return copy;
}

/**
 * Same idea for the whole array getMembers returns, which mention autocomplete asks for on
 * every keystroke. The nickname map only gets a new reference when something is saved, so
 * an unchanged reference means the cached array is still good.
 */
const membersArrayCache = new WeakMap<any[], { nicknameMapRef: NicknameMap; result: any[]; }>();

function getMembersWithNicks(members: any[]): any[] {
    const nicknameMapRef = getNicknameMapRef();

    const cached = membersArrayCache.get(members);
    if (cached && cached.nicknameMapRef === nicknameMapRef) return cached.result;

    // With nothing to replace, hand back the original array untouched
    let result = members;
    for (let i = 0; i < members.length; i++) {
        const member = members[i];
        const nickname = getNickname(member?.userId);
        if (nickname == null) continue;

        if (result === members) result = members.slice();
        result[i] = getMemberWithNick(member, nickname);
    }

    membersArrayCache.set(members, { nicknameMapRef, result });
    return result;
}

interface Wrap {
    target: any;
    method: string;
    original: AnyFn;
    descriptor: PropertyDescriptor | null;
}

const wraps: Wrap[] = [];

/** The unwrapped getName, kept so the real display name is still reachable. */
let originalGetName: AnyFn | null = null;

function wrap(target: any, method: string, make: (original: AnyFn) => AnyFn, label: string): AnyFn | null {
    try {
        const original = target?.[method];
        if (typeof original !== "function") {
            console.warn(`[LocalNicknames] ${label} was not found, so that path will not be replaced.`);
            return null;
        }

        const descriptor = Object.getOwnPropertyDescriptor(target, method) ?? null;
        const wrapper = make(original);

        try {
            target[method] = wrapper;
        } catch {
            // UsernameUtils comes from findByPropsLazy, so it is a module namespace whose
            // exports are getters with no setter and assignment throws. defineProperty
            // reaches the real module through the proxy instead.
            Object.defineProperty(target, method, {
                value: wrapper,
                writable: true,
                enumerable: true,
                configurable: true
            });
        }

        wraps.push({ target, method, original, descriptor });
        return original;
    } catch (e) {
        console.error(`[LocalNicknames] Failed to replace ${label}`, e);
        return null;
    }
}

function applyNameOverrides(): void {
    originalGetName = wrap(UsernameUtils, "getName", original => function (this: any, user: any) {
        return getNickname(user?.id) ?? original.call(this, user);
    }, "UsernameUtils.getName");

    wrap(UsernameUtils, "useName", original => function (this: any, user: any) {
        // A hook, so the original has to run unconditionally and first
        const originalName = original.call(this, user);
        return getNickname(user?.id) ?? originalName;
    }, "UsernameUtils.useName");

    wrap(GuildMemberStore, "getNick", original => function (this: any, guildId: any, userId: any) {
        return getNickname(userId) ?? original.call(this, guildId, userId);
    }, "GuildMemberStore.getNick");

    wrap(RelationshipStore, "getNickname", original => function (this: any, userId: any) {
        return getNickname(userId) ?? original.call(this, userId);
    }, "RelationshipStore.getNickname");

    // Member lists and message headers read getMember().nick rather than getNick(), so
    // replacing getNick alone does nothing inside a server.
    wrap(GuildMemberStore, "getMember", original => function (this: any, guildId: any, userId: any) {
        const member = original.call(this, guildId, userId);
        if (!member) return member;

        const nickname = getNickname(userId);
        if (nickname == null) return member;

        return getMemberWithNick(member, nickname);
    }, "GuildMemberStore.getMember");

    // Mention autocomplete filters the array from getMembers directly, so it needs its own
    // replacement for nicknames to be searchable.
    wrap(GuildMemberStore, "getMembers", original => function (this: any, guildId: any) {
        const members = original.call(this, guildId);
        if (!Array.isArray(members)) return members;

        return getMembersWithNicks(members);
    }, "GuildMemberStore.getMembers");

    // getTrueMember is left alone on purpose. It returns the real member and is a likely
    // source for Discord's own nickname dialog, so replacing it could put a local nickname
    // in front of a save button that sends it to the server.
}

function removeNameOverrides(): void {
    // Only drop entries that were actually restored. Keeping a failed one means its
    // original is still recorded and can be put back later, while popping it would lose
    // the original for good.
    for (let i = wraps.length - 1; i >= 0; i--) {
        const { target, method, original, descriptor } = wraps[i];
        try {
            if (descriptor) Object.defineProperty(target, method, descriptor);
            else target[method] = original;
            wraps.splice(i, 1);
        } catch (e) {
            console.error(`[LocalNicknames] Failed to restore ${method}`, e);
        }
    }

    // If getName could not be restored, keep the original we already hold. Clearing it
    // would let the next start() treat the still-wrapped function as the original, and a
    // nickname could end up saved as a user's real name.
    const getNameRestoreFailed = wraps.some(w => w.method === "getName" && w.target === UsernameUtils);
    if (!getNameRestoreFailed) originalGetName = null;
}

/** getName is replaced by then, so the label has to come from the original. */
function getOriginalName(user: { globalName?: string | null; username: string; }): string {
    try {
        if (originalGetName) return originalGetName.call(UsernameUtils, user);
    } catch {
        // fall through
    }
    return user.globalName || user.username;
}

const UserContext: NavContextMenuPatchCallback = (children, { user }: { user?: User; }) => {
    if (!user) return;
    if (user.id === UserStore.getCurrentUser()?.id) return;

    const s = pickStrings(LocaleStore.locale);
    const current = getNickname(user.id);
    const baseName = getOriginalName(user);

    const open = () => openModal(props => (
        <NicknameModal user={user} baseName={baseName} props={props} />
    ));

    children.push(
        <Menu.MenuGroup>
            <Menu.MenuItem
                id="vc-local-nickname-set"
                label={current ? s.menuChange : s.menuSet}
                action={open}
            />
            {current && (
                <Menu.MenuItem
                    id="vc-local-nickname-clear"
                    label={s.menuClear}
                    action={() => clearNickname(user.id)}
                />
            )}
        </Menu.MenuGroup>
    );
};

export default definePlugin({
    name: "LocalNicknames",

    // Only read when the settings screen renders, so the locale is available by then.
    // A plain string would be fixed at load time, before LocaleStore resolves.
    get description() {
        return pickStrings(LocaleStore?.locale).pluginDescription;
    },

    authors: [EquicordDevs.penguinwokrs],
    tags: ["Appearance", "Customisation"],
    settings,
    settingsAboutComponent: NicknameList,
    contextMenus: {
        "user-context": UserContext
    },

    dependencies: ["ProfileSectionsAPI"],
    renderProfileSection: {
        render: NicknameProfileSection,
        priority: 0
    },

    start() {
        // Settings may have been imported or synced while the plugin was off
        invalidateNicknameCache();
        applyNameOverrides();
    },

    stop() {
        removeNameOverrides();
    }
});
