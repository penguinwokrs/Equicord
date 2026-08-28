/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { BaseText } from "@components/BaseText";
import ErrorBoundary from "@components/ErrorBoundary";
import { RenderModalProps, User } from "@vencord/discord-types";
import { findComponentByCodeLazy } from "@webpack";
import { Button, LocaleStore, Modal, TextInput, UserStore,useState } from "@webpack/common";

import { clearNickname, getNickname, setNickname, settings } from "./settings";
import { initialNicknameInput, lookupLabel, pickStrings, sortedEntries } from "./utils";

/** The headed section Discord shows near "Member Since". Same component voiceStats uses. */
const Section = findComponentByCodeLazy("headingVariant:", '"section"', "headingIcon:");

const noteStyle = {
    marginTop: "8px",
    fontSize: "12px",
    color: "var(--text-muted)"
} as const;

const listRowStyle = {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    marginBottom: "8px"
} as const;

const profileRowStyle = {
    display: "flex",
    gap: "6px"
} as const;

const profileLabelStyle = {
    color: "var(--text-muted)"
} as const;

interface ModalProps {
    user: User;
    /** The user's real display name. Shown under the title and saved as the label. */
    baseName: string;
    props: RenderModalProps;
}

function NicknameModalInner({ user, baseName, props }: ModalProps) {
    const s = pickStrings(LocaleStore.locale);
    const existing = getNickname(user.id);
    const [value, setValue] = useState(() => initialNicknameInput(existing, baseName));

    const save = () => {
        setNickname(user.id, value, baseName);
        props.onClose();
    };

    return (
        <Modal
            {...props}
            size="sm"
            title={existing ? s.modalTitleChange : s.modalTitleSet}
            subtitle={baseName}
            actions={[
                { text: s.ok, variant: "primary", onClick: save },
                { text: s.cancel, variant: "secondary", onClick: () => props.onClose() }
            ]}
        >
            {/* TextInput's own onKeyDown typing is unreliable, so listen on the wrapper. */}
            <div onKeyDown={e => {
                // Enter while an IME is composing confirms the conversion, it is not a submit
                if (e.nativeEvent.isComposing) return;
                if (e.key === "Enter") {
                    // Without this the Enter reaches the message box behind the modal
                    // and inserts a newline there
                    e.preventDefault();
                    e.stopPropagation();
                    e.nativeEvent.stopImmediatePropagation?.();
                    save();
                }
            }}>
                <TextInput
                    value={value}
                    onChange={setValue}
                    placeholder={s.inputPlaceholder}
                    autoFocus
                />
            </div>
            <div style={noteStyle}>{s.emptyToClear}</div>
            <div style={noteStyle}>{s.reloadHint}</div>
        </Modal>
    );
}

function NicknameListInner() {
    const s = pickStrings(LocaleStore.locale);
    const { nicknames } = settings.use(["nicknames"]);
    const entries = sortedEntries(nicknames);

    if (entries.length === 0) {
        return <div style={{ color: "var(--text-muted)" }}>{s.listEmpty}</div>;
    }

    return (
        <>
            <div style={{ marginBottom: "8px", fontWeight: 600 }}>{s.listTitle}</div>
            {entries.map(entry => {
                // Prefer the live name, fall back to the one saved with the entry
                const user = UserStore.getUser(entry.userId);
                const original = user ? (user.globalName || user.username) : entry.label;

                return (
                    <div key={entry.userId} style={listRowStyle}>
                        <span style={{ flex: 1 }}>{original} → {entry.nickname}</span>
                        <Button
                            size={Button.Sizes.SMALL}
                            color={Button.Colors.RED}
                            onClick={() => clearNickname(entry.userId)}
                        >
                            {s.delete}
                        </Button>
                    </div>
                );
            })}
        </>
    );
}

function ProfileRow({ label, value }: { label: string; value: string; }) {
    return (
        <div style={profileRowStyle}>
            <BaseText size="sm" style={profileLabelStyle}>{label}</BaseText>
            <BaseText size="sm">{value}</BaseText>
        </div>
    );
}

function NicknameProfileSectionInner({ userId, isSideBar }: { userId: string; isSideBar: boolean; }) {
    const s = pickStrings(LocaleStore.locale);
    // Subscribe so the section re-renders when a nickname is added, changed or removed
    const { nicknames } = settings.use(["nicknames"]);

    const nickname = getNickname(userId);
    // No section at all for users without a nickname
    if (!nickname) return null;

    // Read the real name off the user object directly. That path does not go through the
    // replaced getName, so it gives the original name rather than the nickname.
    const user = UserStore.getUser(userId);
    const original = (user && (user.globalName || user.username)) || lookupLabel(nicknames, userId) || userId;

    return (
        <Section
            heading={s.profileSection}
            headingVariant={isSideBar ? "text-xs/semibold" : "text-xs/medium"}
            headingColor={isSideBar ? "text-strong" : "text-default"}
        >
            <ProfileRow label={s.originalName} value={original} />
            <ProfileRow label={s.nickname} value={nickname} />
        </Section>
    );
}

export const NicknameModal = ErrorBoundary.wrap(NicknameModalInner, { noop: true });
export const NicknameList = ErrorBoundary.wrap(NicknameListInner, { noop: true });
export const NicknameProfileSection = ErrorBoundary.wrap(NicknameProfileSectionInner, { noop: true });
