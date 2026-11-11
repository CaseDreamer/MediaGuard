# MediaGuard

A Vencord plugin that keeps unwanted media out of your face.

Blur every image, GIF and video until you click it, and turn bots, apps, webhooks or specific users into a "click to show" card so nothing loads unless you ask for it.

## Features

- **Blur until clicked** - attachments, embed previews, thumbnails and videos stay blurred until you click them.
- **Per-user block** - right-click a username or profile and pick *Blur media from this user*. Their media becomes a click-to-load card and stays that way across restarts.
- **Bot shield** - media from bots, apps and webhooks is replaced with a card, nothing downloads or renders.
- **Blur everyone** - optional master switch. Off by default, so only blocked users and bots are affected.
- **Blocked list** - every blocked user appears in the plugin settings with an *Unblur* button.
- **Live settings** - changes apply without restarting Discord.

## Requirements

- [Vencord](https://vencord.dev) installed from source. Userplugins are compiled at build time, so the prebuilt installer will not pick this up.
- Node.js 22+
- pnpm

## Install

1. Clone Vencord and install its dependencies:

```sh
git clone https://github.com/Vendicated/Vencord
cd Vencord
pnpm install
```

2. Clone this plugin into Vencord's userplugins folder:

```sh
git clone https://github.com/CaseDreamer/MediaGuard.git src/userplugins/MediaGuard
```

3. Build and inject:

```sh
pnpm build
pnpm inject
```

4. Restart Discord, then open **Settings → Vencord → Plugins → User Plugins → MediaGuard** and enable it.

### Manual install

If you don't want git inside Vencord, create `Vencord/src/userplugins/MediaGuard/` and drop `index.tsx` from this repo into it, then run `pnpm build`.

### Updating

```sh
cd src/userplugins/MediaGuard
git pull
cd ../../..
pnpm build
```

Restart Discord afterwards.

## Usage

- **Reveal something** - click the blurred media or the hidden card. A second click opens Discord's normal viewer.
- **Blur someone** - right-click their name in chat, or open their profile and use the context menu → *Blur media from this user*.
- **Unblock someone** - right-click them again → *Stop blurring media from this user*, or remove them from the settings list.
- **Blur everything** - turn on *Blur everyone's media* in the plugin settings.

## Settings

| Setting | Default | Description |
|---|---|---|
| Blur everyone's media | off | Blurs every attachment, embed image, thumbnail, GIF and video in chat until clicked. Off means only blocked users and bots are hidden. |
| Blur amount | 32 px | Blur radius, 8–80 px. |
| Blur videos | on | Also covers videos and GIFs (Discord renders GIFs as videos). |
| Blur embeds | on | Media inside link previews, thumbnails and embed players. |
| Shield bot attachments | on | Replaces attachments from bots, apps and webhooks with a click-to-load card. |
| Blocked users | — | Everyone you blocked, each with an *Unblur* button. |

Blocked users are stored in Vencord's settings under `plugins.MediaGuard.blockedUserIds`, so they survive restarts and carry over with a settings export.

## How it works

- A `MutationObserver` watches the message list and re-scans after new messages, edits, lazy image loads and React re-renders.
- The message author is resolved from the chat message id (`chat-messages-<channel>-<message>`) through Discord's `MessageStore`, with the avatar CDN URL as a fallback for messages that aren't in the store.
- Blur is a CSS `filter` on a class; the strength comes from the `--vc-mg-blur` custom property.
- Clicks are caught in the capture phase on `document`, so the reveal click never opens the image viewer.
- Blocked and bot media is hidden through its nearest media wrapper, which means the image never renders — not just visually hidden.
- Avatars, emojis, badges, icons and reactions are excluded by class, and small unclassed images are excluded by size, so only real media is touched.
- Nothing is injected into the DOM beyond classes and the plugin's own stylesheet, which keeps React happy and makes `stop()` clean.

## BetterDiscord

Not compatible. This plugin is written against Vencord's plugin API (`definePlugin`, plugin settings components, the context menu patcher, `MessageStore`), which BetterDiscord does not provide. A BetterDiscord version would be a separate port.

## Tested on

- Discord stable, Windows
- Vencord 1.15.17 (source build)
