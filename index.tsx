import type { NavContextMenuPatchCallback } from "@api/ContextMenu";
import { definePluginSettings } from "@api/Settings";
import { Button } from "@components/Button";
import { Paragraph } from "@components/Paragraph";
import { Span } from "@components/Span";
import definePlugin, { OptionType } from "@utils/types";
import { Menu, MessageStore, showToast, UserStore } from "@webpack/common";

const STYLE_ID = "vc-media-guard-style";

const BLUR = "vc-mg-blur";
const REVEALED = "vc-mg-revealed";
const SHIELD = "vc-mg-shield";
const REASON_ATTR = "vcMgReason";

const MESSAGE_SELECTOR = '[class*="messageListItem"], li[id^="chat-messages-"]';
const MEDIA_SELECTOR = "img, video, iframe";
const BG_MEDIA_SELECTOR = '[class*="embed"] [style*="background-image"], [class*="imageWrapper"][style*="background-image"], [class*="thumbnail"][style*="background-image"]';
const EMBED_SELECTOR = '[class*="embedWrapper"]';
const NON_MEDIA_SELECTOR = '[class*="nonMediaAttachment"]';
// Discord renders the same tag element for BOT, VERIFIED BOT, APP and WEBHOOK messages
const BOT_TAG_SELECTOR = '[class*="botTag"], [class*="botText"], [class*="appTag"], [class*="webhookTag"]';

const WRAPPER_SELECTOR = [
    '[class*="imageWrapper"]',
    '[class*="embedImage"]',
    '[class*="embedThumbnail"]',
    '[class*="embedVideo"]',
    '[class*="embedMedia"]',
    '[class*="embedIframe"]',
    '[class*="nonMediaAttachment"]',
    '[class*="sticker"]'
].join(",");

// avatars, emojis, badges, embed icons and reactions are never media
const IGNORE_CLASS = /(emoji|avatar|badge|icon|reaction)/i;

interface UserLike {
    id: string;
    username?: string;
    globalName?: string;
}

const settings = definePluginSettings({
    blurAll: {
        type: OptionType.BOOLEAN,
        description: "Blur everyone's media until you click it. Turn this off to only affect users you blocked and bots.",
        default: false
    },
    blurOwnMessages: {
        type: OptionType.BOOLEAN,
        description: "Also blur media in your own messages. Off by default, so you always see what you uploaded.",
        default: false
    },
    blurStrength: {
        type: OptionType.SLIDER,
        description: "How hard the blur is, in pixels",
        markers: [8, 16, 24, 32, 48, 64, 80],
        default: 32,
        stickToMarkers: false
    },
    blurVideos: {
        type: OptionType.BOOLEAN,
        description: "Also blur videos and GIFs",
        default: true
    },
    blurEmbeds: {
        type: OptionType.BOOLEAN,
        description: "Also blur media inside link embeds (previews, thumbnails, players)",
        default: true
    },
    shieldBotAttachments: {
        type: OptionType.BOOLEAN,
        description: "Replace attachments from bots / apps / webhooks with a click-to-load card",
        default: true
    },
    blockedUsers: {
        type: OptionType.COMPONENT,
        component: BlockedUsersComponent
    }
}).withPrivateSettings<{
    blockedUserIds: string[];
}>();

const STYLE = `
:root {
    --vc-mg-blur: 32px;
}

.${BLUR} {
    filter: blur(var(--vc-mg-blur)) !important;
    transition: filter 120ms ease-out;
    cursor: pointer;
}

.${BLUR}.${REVEALED} {
    filter: none !important;
}

.${BLUR}:not(.${REVEALED}) iframe,
.${BLUR}:not(.${REVEALED}) video {
    pointer-events: none !important;
}

.${SHIELD} {
    display: flex !important;
    align-items: center !important;
    justify-content: center !important;
    gap: 8px !important;
    flex: 0 0 auto !important;
    width: 288px !important;
    max-width: 100% !important;
    height: 56px !important;
    padding: 0 12px !important;
    box-sizing: border-box !important;
    background: var(--background-secondary-alt) !important;
    border: 1px solid var(--background-modifier-accent) !important;
    border-radius: 8px !important;
    color: var(--text-muted) !important;
    font-size: 13px !important;
    font-weight: 500 !important;
    letter-spacing: 0 !important;
    cursor: pointer !important;
    user-select: none !important;
    overflow: hidden !important;
}

.${SHIELD}:hover {
    border-color: var(--brand-500) !important;
    color: var(--text-normal) !important;
}

.${SHIELD} > * {
    display: none !important;
}

.${SHIELD}::before {
    content: "\\1F512";
    font-size: 14px;
    line-height: 1;
}

.${SHIELD}::after {
    content: "Attachment from bot / app \\2014 click to show";
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}

.${SHIELD}[data-vc-mg-reason="user"]::after {
    content: "Media from a blocked user \\2014 click to show";
}
`;

let observer: MutationObserver | null = null;
let scanTimer: number | null = null;
let settingsTimer: number | null = null;
let fingerprint = "";

function getBlockedIds(): string[] {
    return settings.store.blockedUserIds ?? [];
}

function isUserBlocked(userId: string | null | undefined): boolean {
    return !!userId && getBlockedIds().includes(userId);
}

function displayName(user: UserLike | { id: string; }) {
    const live = UserStore.getUser(user.id);
    if (live?.globalName) return live.globalName;
    if (live?.username) return live.username;
    return (user as UserLike).username || user.id;
}

function setBlockedIds(ids: string[]) {
    settings.store.blockedUserIds = [...new Set(ids)];
    resetClasses();
}

function toggleUser(user: UserLike) {
    const blocked = isUserBlocked(user.id);

    setBlockedIds(
        blocked
            ? getBlockedIds().filter(id => id !== user.id)
            : [...getBlockedIds(), user.id]
    );

    showToast({
        text: blocked
            ? `Media from ${displayName(user)} is visible again`
            : `Media from ${displayName(user)} is now hidden`,
        variant: "success"
    });
}

function BlockedUsersComponent() {
    const { blockedUserIds = [] } = settings.use(["blockedUserIds"]);

    if (!blockedUserIds.length) {
        return <Paragraph>Nobody is blocked. Right-click a user and pick "Blur media from this user".</Paragraph>;
    }

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {blockedUserIds.map(id => {
                const user = UserStore.getUser(id);
                const name = user?.globalName || user?.username || id;

                return (
                    <div key={id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                        <Span>{name}</Span>
                        <Button
                            size="small"
                            variant="dangerSecondary"
                            onClick={() => setBlockedIds(getBlockedIds().filter(x => x !== id))}
                        >
                            Unblur
                        </Button>
                    </div>
                );
            })}
        </div>
    );
}

const userContextPatch: NavContextMenuPatchCallback = (children, props: { user?: UserLike; }) => {
    const user = props?.user;
    if (!user?.id) return;

    const blocked = isUserBlocked(user.id);

    children.push(
        <Menu.MenuItem
            id="vc-media-guard-toggle-user"
            label={blocked ? "Stop blurring media from this user" : "Blur media from this user"}
            action={() => toggleUser(user)}
        />
    );
};

function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;

    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = STYLE;
    document.head.appendChild(style);
}

function applyBlurVar() {
    document.documentElement.style.setProperty("--vc-mg-blur", `${settings.store.blurStrength}px`);
}

function hasBotTag(msg: HTMLElement): boolean {
    return msg.querySelector(BOT_TAG_SELECTOR) !== null;
}

function getMessageAuthorId(msg: HTMLElement): string | null {
    const raw = msg.id || msg.getAttribute("data-list-item-id") || "";
    const match = /chat-messages-(\d{15,25})-(\d{15,25})$/.exec(raw);

    if (match) {
        const authorId = MessageStore.getMessage(match[1], match[2])?.author?.id;
        if (authorId) return authorId;
    }

    const avatar = msg.querySelector<HTMLImageElement>('img[class*="avatar"]');
    return avatar?.src?.match(/\/avatars\/(\d+)\//)?.[1] ?? null;
}

function shieldTarget(media: HTMLElement): HTMLElement {
    return (media.closest<HTMLElement>(WRAPPER_SELECTOR) ?? media.parentElement ?? media) as HTMLElement;
}

function isIgnoredMedia(el: HTMLElement): boolean {
    if (IGNORE_CLASS.test(el.className)) return true;
    if (el.closest('[class*="reaction"]')) return true;

    // tiny unclassed images are UI icons, real attachments always have a wrapper
    if (el.tagName === "IMG" && !el.closest(WRAPPER_SELECTOR)) {
        const rect = el.getBoundingClientRect();
        const size = Math.max(rect.width, rect.height);
        if (size > 0 && size < 80) return true;
    }

    return false;
}

function shieldElement(el: HTMLElement, reason: string) {
    if (el.dataset.vcMgRevealed === "1") return;

    el.classList.remove(BLUR);
    if (!el.classList.contains(SHIELD)) el.classList.add(SHIELD);
    el.dataset[REASON_ATTR] = reason;
}

function scanMessage(msg: HTMLElement) {
    const authorId = getMessageAuthorId(msg);
    const isOwn = authorId !== null && authorId === UserStore.getCurrentUser()?.id;

    if (isOwn && !settings.store.blurOwnMessages) return;

    const blocked = isUserBlocked(authorId);
    const shielded = blocked || (settings.store.shieldBotAttachments && hasBotTag(msg));
    const blurAll = settings.store.blurAll;

    if (!blurAll && !shielded) return;

    const reason = blocked ? "user" : "bot";

    if (shielded) {
        for (const attachment of Array.from(msg.querySelectorAll<HTMLElement>(NON_MEDIA_SELECTOR))) {
            shieldElement(attachment, reason);
        }
    }

    for (const media of Array.from(msg.querySelectorAll<HTMLElement>(MEDIA_SELECTOR))) {
        if (media.dataset.vcMgRevealed === "1") continue;
        if (isIgnoredMedia(media)) continue;

        if (shielded) {
            shieldElement(shieldTarget(media), reason);
            continue;
        }

        const tag = media.tagName;

        if (tag === "VIDEO" && !settings.store.blurVideos) continue;
        if (tag === "IFRAME" && !settings.store.blurEmbeds) continue;
        if (!settings.store.blurEmbeds && media.closest(EMBED_SELECTOR)) continue;

        if (!media.classList.contains(BLUR)) media.classList.add(BLUR);
    }

    if (!shielded && blurAll && settings.store.blurEmbeds) {
        for (const bg of Array.from(msg.querySelectorAll<HTMLElement>(BG_MEDIA_SELECTOR))) {
            if (bg.dataset.vcMgRevealed === "1") continue;
            if (!bg.classList.contains(BLUR)) bg.classList.add(BLUR);
        }
    }
}

function scan() {
    if (!document.body) return;

    for (const msg of Array.from(document.querySelectorAll<HTMLElement>(MESSAGE_SELECTOR))) {
        scanMessage(msg);
    }
}

function scheduleScan() {
    if (scanTimer !== null) return;

    scanTimer = window.setTimeout(() => {
        scanTimer = null;
        scan();
    }, 100);
}

function resetClasses() {
    for (const el of Array.from(document.querySelectorAll<HTMLElement>(`.${BLUR}, .${SHIELD}`))) {
        el.classList.remove(BLUR, SHIELD);
    }

    scan();
}

function onClick(event: MouseEvent) {
    const target = event.target as HTMLElement | null;
    if (!target || typeof target.closest !== "function") return;

    const shield = target.closest<HTMLElement>(`.${SHIELD}`);
    if (shield) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();

        shield.classList.remove(SHIELD);
        shield.dataset.vcMgRevealed = "1";
        return;
    }

    const blurred = target.closest<HTMLElement>(`.${BLUR}`);
    if (blurred && !blurred.classList.contains(REVEALED)) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();

        blurred.classList.add(REVEALED);
        blurred.dataset.vcMgRevealed = "1";
    }
}

function currentFingerprint(): string {
    return [
        settings.store.blurAll,
        settings.store.blurOwnMessages,
        settings.store.blurStrength,
        settings.store.blurVideos,
        settings.store.blurEmbeds,
        settings.store.shieldBotAttachments,
        getBlockedIds().join(",")
    ].join("|");
}

function syncSettings() {
    const next = currentFingerprint();
    if (next === fingerprint) return;

    fingerprint = next;
    applyBlurVar();
    resetClasses();
}

function teardownDom() {
    for (const el of Array.from(document.querySelectorAll<HTMLElement>(`.${BLUR}, .${SHIELD}, .${REVEALED}`))) {
        el.classList.remove(BLUR, SHIELD, REVEALED);
        delete el.dataset.vcMgRevealed;
        delete el.dataset[REASON_ATTR];
    }

    document.getElementById(STYLE_ID)?.remove();
    document.documentElement.style.removeProperty("--vc-mg-blur");
}

export default definePlugin({
    name: "MediaGuard",
    description: "Blurs every image, GIF and video in chat until you click it, and lets you hide media from specific users or bots behind a click-to-load card.",
    authors: [{ name: "Case", id: 439449505805500424n }],

    settings,

    contextMenus: {
        "user-context": userContextPatch,
        "user-profile-actions": userContextPatch,
        "user-profile-overflow-menu": userContextPatch
    },

    start() {
        injectStyle();
        applyBlurVar();
        fingerprint = currentFingerprint();

        document.addEventListener("click", onClick, true);

        observer = new MutationObserver(scheduleScan);
        observer.observe(document.body, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ["class"]
        });

        settingsTimer = window.setInterval(syncSettings, 1500);

        scheduleScan();
    },

    stop() {
        if (observer) {
            observer.disconnect();
            observer = null;
        }

        if (settingsTimer !== null) {
            window.clearInterval(settingsTimer);
            settingsTimer = null;
        }

        if (scanTimer !== null) {
            window.clearTimeout(scanTimer);
            scanTimer = null;
        }

        document.removeEventListener("click", onClick, true);
        teardownDom();
    }
});
