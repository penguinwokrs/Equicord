/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export interface NicknameEntry {
    nickname: string;
    /** The user's real display name when the nickname was saved, so the settings list can say who this is. */
    label: string;
}

export type NicknameMap = Record<string, NicknameEntry>;

export function lookupNickname(map: NicknameMap | undefined, userId: string | undefined): string | null {
    if (!map || !userId) return null;

    const entry = map[userId];
    if (!entry || typeof entry.nickname !== "string") return null;

    const trimmed = entry.nickname.trim();
    return trimmed.length === 0 ? null : trimmed;
}

export function lookupLabel(map: NicknameMap | undefined, userId: string | undefined): string | null {
    if (!map || !userId) return null;

    const entry = map[userId];
    if (!entry || typeof entry.label !== "string" || entry.label.length === 0) return null;

    return entry.label;
}

export function sortedEntries(map: NicknameMap | undefined): Array<{ userId: string; nickname: string; label: string; }> {
    if (!map) return [];

    return Object.entries(map)
        .filter(([, entry]) => entry != null && typeof entry.nickname === "string" && entry.nickname.trim().length > 0)
        .map(([userId, entry]) => ({
            userId,
            nickname: entry.nickname.trim(),
            label: typeof entry.label === "string" && entry.label.length > 0 ? entry.label : userId
        }))
        .sort((a, b) => a.label.localeCompare(b.label));
}

/**
 * Rebuilds every entry as a fresh plain object. Values read back through the settings
 * proxy cannot be structured cloned, and saving would throw when they reach the native
 * settings write.
 */
function rebuildAsPlainMap(source: NicknameMap | undefined): NicknameMap {
    const next: NicknameMap = {};
    if (!source) return next;

    for (const [userId, entry] of Object.entries(source)) {
        if (!entry || typeof entry.nickname !== "string") continue;

        const trimmed = entry.nickname.trim();
        if (trimmed.length === 0) continue;

        next[userId] = {
            nickname: trimmed,
            label: typeof entry.label === "string" && entry.label.length > 0 ? entry.label : userId
        };
    }

    return next;
}

/** Returns a new map with the nickname set. An empty nickname removes the entry. */
export function withNickname(map: NicknameMap | undefined, userId: string, nickname: string, label: string): NicknameMap {
    const next = rebuildAsPlainMap(map);

    const trimmed = nickname.trim();
    if (trimmed.length === 0) delete next[userId];
    else next[userId] = { nickname: trimmed, label };

    return next;
}

/** Returns a new map without the entry for this user. */
export function withoutNickname(map: NicknameMap | undefined, userId: string): NicknameMap {
    const next = rebuildAsPlainMap(map);
    delete next[userId];
    return next;
}

export function withMemberNick(member: Record<string, any>, nickname: string): Record<string, any> {
    return { ...member, nick: nickname };
}

/**
 * Starting value for the nickname field. Users who already have one see it, users who
 * do not see their real name so they can edit it instead of retyping it.
 */
export function initialNicknameInput(existing: string | null | undefined, baseName: string | undefined): string {
    if (typeof existing === "string" && existing.trim().length > 0) return existing;
    return typeof baseName === "string" ? baseName.trim() : "";
}

const en = {
    pluginDescription: "Give other users a nickname that only exists in your own client. It stays the same across every server.",
    menuSet: "Set local nickname",
    menuChange: "Change local nickname",
    menuClear: "Clear local nickname",
    modalTitleSet: "Set a local nickname",
    modalTitleChange: "Change local nickname",
    inputPlaceholder: "Nickname",
    ok: "OK",
    cancel: "Cancel",
    emptyToClear: "Leave the field empty and press OK to clear the nickname.",
    reloadHint: "If a name is still stale somewhere, press Ctrl+R to reload.",
    listTitle: "Saved nicknames",
    listEmpty: "No nicknames yet. Right-click a user and choose \"Set local nickname\".",
    delete: "Delete",
    profileSection: "Local nickname",
    originalName: "Original name",
    nickname: "Nickname",
    settingsDescription: "Map of local nicknames, keyed by user ID"
} as const;

/** Forces every translation to carry all the English keys, with the values widened to string. */
export type Strings = { readonly [K in keyof typeof en]: string };

const ja: Strings = {
    pluginDescription: "他のユーザーに、自分のクライアント内でのみ有効なニックネームを付けます。サーバーをまたいでも同じ表示になります。",
    menuSet: "ニックネームを付ける",
    menuChange: "ニックネームを変更",
    menuClear: "ニックネームを解除",
    modalTitleSet: "ニックネームを付ける",
    modalTitleChange: "ニックネームを変更",
    inputPlaceholder: "ニックネーム",
    ok: "OK",
    cancel: "キャンセル",
    emptyToClear: "空欄のまま OK を押すとニックネームを解除します。",
    reloadHint: "反映されない箇所があれば Ctrl+R で再読み込みしてください。",
    listTitle: "保存済みのニックネーム",
    listEmpty: "まだニックネームは登録されていません。ユーザーを右クリックして「ニックネームを付ける」から登録できます。",
    delete: "削除",
    profileSection: "ローカルニックネーム",
    originalName: "元の名前",
    nickname: "ニックネーム",
    settingsDescription: "ユーザーIDをキーとするローカルニックネームのマップ"
};

/** Takes the locale as an argument so this file stays free of store imports. */
export function pickStrings(locale: string | undefined | null): Strings {
    return typeof locale === "string" && locale.toLowerCase().startsWith("ja") ? ja : en;
}
