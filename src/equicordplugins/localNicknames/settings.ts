/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { OptionType } from "@utils/types";
import { GuildMemberStore, RelationshipStore, UserStore } from "@webpack/common";

import { lookupNickname, NicknameMap, withNickname, withoutNickname } from "./utils";

export const settings = definePluginSettings({
    nicknames: {
        type: OptionType.CUSTOM,
        description: "Map of local nicknames, keyed by user ID",
        default: {} as NicknameMap
    }
});

/**
 * Reading through settings.store builds a fresh proxy on every access, which is too much
 * for a lookup that runs on every render, so reads go through settings.plain and the
 * result is held here until a write replaces it.
 *
 * Importing settings or downloading them from cloud sync mutates the root object in place
 * rather than replacing settings.plain, so this reference can go stale while the plugin is
 * disabled. start() clears it for that reason.
 */
let cachedNicknames: NicknameMap | undefined;

function getNicknameMap(): NicknameMap {
    if (cachedNicknames === undefined) cachedNicknames = settings.plain.nicknames;
    return cachedNicknames;
}

export function invalidateNicknameCache(): void {
    cachedNicknames = undefined;
}

/**
 * The current map, by reference. Writes always build a new plain object, so an unchanged
 * reference means unchanged content, which is what the getMembers cache checks.
 * Returns a fresh empty object on failure so that cache always misses.
 */
export function getNicknameMapRef(): NicknameMap {
    try {
        return getNicknameMap();
    } catch {
        return {};
    }
}

/** Called from the innermost render paths, so it must never throw. */
export function getNickname(userId: string | undefined): string | null {
    if (!userId) return null;

    try {
        // Never yourself. GuildMemberStore.getNick also fills the "Edit Server Profile"
        // nickname field, and replacing it there could overwrite your own nickname.
        if (userId === UserStore.getCurrentUser()?.id) return null;

        return lookupNickname(getNicknameMap(), userId);
    } catch {
        return null;
    }
}

/** Saving an empty nickname clears it. label is the user's real display name at save time. */
export function setNickname(userId: string, input: string, label: string): void {
    const next = withNickname(settings.plain.nicknames, userId, input, label);

    // Assigning to settings.store notifies listeners synchronously, so clear the cache
    // first or a listener that re-renders immediately reads the old map.
    invalidateNicknameCache();
    settings.store.nicknames = next;
    notifyNicknameChange();
}

export function clearNickname(userId: string): void {
    const next = withoutNickname(settings.plain.nicknames, userId);

    invalidateNicknameCache();
    settings.store.nicknames = next;
    notifyNicknameChange();
}

/**
 * Tells the stores whose reads are intercepted that something changed, so rendered
 * components read again. No data is touched and nothing is sent to Discord.
 */
function notifyNicknameChange(): void {
    try {
        UserStore.emitChange();
    } catch (e) {
        console.error("[LocalNicknames] Failed to emit change on UserStore", e);
    }

    try {
        GuildMemberStore.emitChange();
    } catch (e) {
        console.error("[LocalNicknames] Failed to emit change on GuildMemberStore", e);
    }

    try {
        RelationshipStore.emitChange();
    } catch (e) {
        console.error("[LocalNicknames] Failed to emit change on RelationshipStore", e);
    }
}
