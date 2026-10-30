/**
 * @name FacebookVideoPlayer
 * @author Simonfas
 * @description Plays Facebook videos and Reels inside Discord, supports share links, and hides native Facebook previews.
 * @version 1.4.1
 */

module.exports = class FacebookVideoPlayer {
    constructor() {
        this.styleId = "FacebookVideoPlayer-Style";
        this.observer = null;
        this.raf = null;
        this.enabled = false;
        this.pending = new Map();
        this.cache = new Map();
        this.saved = {};
    }

    start() {
        this.enabled = true;

        this.saved =
            BdApi.Data.load(
                "FacebookVideoPlayer",
                "resolvedLinks"
            ) || {};

        BdApi.DOM.addStyle(this.styleId, `
            .sf-fb-native-hidden {
                display: none !important;
            }

            .sf-fb-card {
                box-sizing: border-box;
                width: min(560px, 100%);
                max-width: 100%;
                margin: 8px 0;
                overflow: hidden;
                border: 1px solid var(
                    --border-subtle,
                    rgba(255,255,255,.12)
                );
                border-radius: 10px;
                background: var(
                    --background-secondary,
                    #242428
                );
            }

            .sf-fb-card.sf-fb-reel {
                width: min(390px, 100%);
            }

            .sf-fb-head {
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 12px;
                padding: 10px 12px;
                font-size: 13px;
                font-weight: 600;
                color: var(--text-normal, #eee);
            }

            .sf-fb-head a {
                font-size: 12px;
                font-weight: 400;
                color: var(--text-link, #79adff);
                text-decoration: none;
            }

            .sf-fb-head a:hover {
                text-decoration: underline;
            }

            .sf-fb-frame-wrapper {
                position: relative;
                width: 100%;
                aspect-ratio: 16 / 9;
                overflow: hidden;
                background: #111;
            }

            .sf-fb-frame-wrapper iframe {
                display: block;
                width: 100%;
                height: 100%;
                border: none;
                background: #111;
            }

            /*
             * Facebook Reel crop.
             *
             * Facebook's embed sometimes places a large
             * empty area beneath the actual Reel.
             *
             * Keep the iframe at its original 9:16
             * dimensions, but crop its visible area
             * to prevent the empty bottom section.
             */

            .sf-fb-card.sf-fb-reel
            .sf-fb-frame-wrapper {
                aspect-ratio: 3 / 4;
                overflow: hidden;
            }

            .sf-fb-card.sf-fb-reel
            .sf-fb-frame-wrapper iframe {
                width: 100%;
                height: auto;
                aspect-ratio: 9 / 16;
                border: none;
                display: block;
            }

            .sf-fb-message {
                padding: 6px 12px 12px;
                font-size: 12px;
                line-height: 1.5;
                color: var(--text-muted, #aaa);
            }

            .sf-fb-buttons {
                display: flex;
                flex-wrap: wrap;
                gap: 8px;
                padding: 0 12px 12px;
            }

            .sf-fb-buttons button {
                padding: 7px 10px;
                border: 0;
                border-radius: 5px;
                background: var(
                    --button-secondary-background,
                    #45454d
                );
                color: var(--text-normal, #fff);
                cursor: pointer;
                font-size: 12px;
                transition: filter .15s;
            }

            .sf-fb-buttons button:hover {
                filter: brightness(1.15);
            }

            .sf-fb-input {
                display: block;
                box-sizing: border-box;
                width: calc(100% - 24px);
                margin: 0 12px 8px;
                padding: 8px;
                border: 1px solid var(
                    --border-subtle,
                    rgba(255,255,255,.18)
                );
                border-radius: 5px;
                background: var(
                    --input-background,
                    #151519
                );
                color: var(--text-normal, #fff);
            }
        `);

        this.scan();

        this.observer = new MutationObserver(
            () => this.scheduleScan()
        );

        this.observer.observe(document.body, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ["href"]
        });
    }

    stop() {
        this.enabled = false;

        this.observer?.disconnect();
        this.observer = null;

        if (this.raf !== null) {
            cancelAnimationFrame(this.raf);
        }

        this.raf = null;

        document.querySelectorAll(".sf-fb-card")
            .forEach(element => element.remove());

        document.querySelectorAll(
            ".sf-fb-native-hidden"
        ).forEach(element => {
            element.classList.remove(
                "sf-fb-native-hidden"
            );
        });

        BdApi.DOM.removeStyle(this.styleId);

        this.pending.clear();
        this.cache.clear();
    }

    scheduleScan() {
        if (!this.enabled || this.raf !== null) {
            return;
        }

        this.raf = requestAnimationFrame(() => {
            this.raf = null;
            this.scan();
        });
    }

    parse(input) {
        let url;

        try {
            url = new URL(input);
        } catch {
            return null;
        }

        if (
            !["https:", "http:"].includes(url.protocol) ||
            url.username ||
            url.password
        ) {
            return null;
        }

        const host = url.hostname.toLowerCase();

        const validHost =
            host === "facebook.com" ||
            host.endsWith(".facebook.com") ||
            host === "fb.watch" ||
            host === "www.fb.watch";

        if (!validHost) {
            return null;
        }

        const path = url.pathname;

        const share =
            host === "fb.watch" ||
            host === "www.fb.watch" ||
            /^\/share\/(?:v|r)\/[^/]+/i.test(path);

        const reel =
            /^\/reels?\/(\d+)\/?$/i.exec(path);

        const watch =
            /^\/(?:watch\/?|video\.php)$/i.test(path) &&
            /^\d+$/.test(
                url.searchParams.get("v") || ""
            );

        const video =
            /\/videos\/(?:[^/]+\/)?\d+\/?$/i.test(path);

        if (!share && !reel && !watch && !video) {
            return null;
        }

        if (share) {
            url.protocol = "https:";
            url.hash = "";

            return {
                url: url.toString(),
                share: true,
                reel: /^\/share\/r\//i.test(path)
            };
        }

        if (reel) {
            return {
                url:
                    "https://www.facebook.com/reel/" +
                    reel[1] + "/",
                share: false,
                reel: true
            };
        }

        if (watch) {
            return {
                url:
                    "https://www.facebook.com/watch/?v=" +
                    url.searchParams.get("v"),
                share: false,
                reel: false
            };
        }

        return {
            url: "https://www.facebook.com" + path,
            share: false,
            reel: false
        };
    }

    direct(input) {
        const parsed = this.parse(input);

        return parsed && !parsed.share
            ? parsed.url
            : null;
    }

    decode(value) {
        if (typeof value !== "string") {
            return "";
        }

        return value
            .replace(/&amp;/g, "&")
            .replace(/&#38;/g, "&")
            .replace(/\\u0026/gi, "&")
            .replace(/\\u002f/gi, "/")
            .replace(/\\\//g, "/")
            .replace(/&quot;/g, '"');
    }

    extract(html, base) {
        if (!html || typeof html !== "string") {
            return null;
        }

        const found = [];

        try {
            const doc = new DOMParser().parseFromString(
                html,
                "text/html"
            );

            for (const selector of [
                'meta[property="og:url"]',
                'meta[name="twitter:url"]',
                'link[rel="canonical"]'
            ]) {
                const element =
                    doc.querySelector(selector);

                if (element) {
                    found.push(
                        element.getAttribute("content") ||
                        element.getAttribute("href")
                    );
                }
            }

            const refresh = doc.querySelector(
                'meta[http-equiv="refresh"]'
            );

            const match = refresh
                ?.getAttribute("content")
                ?.match(/url\s*=\s*['"]?([^'";]+)/i);

            if (match) {
                found.push(match[1]);
            }
        } catch {}

        const pattern =
            /https?(?:\\\/|\/){2}(?:www\.|m\.|web\.)?facebook\.com(?:\\\/|\/)(?:reel\/\d+|watch\/\?v=\d+|[^\s"'<>\\]{1,120}\/videos\/\d+)/gi;

        for (const match of html.matchAll(pattern)) {
            found.push(match[0]);
        }

        for (const raw of found) {
            try {
                const url = new URL(
                    this.decode(raw),
                    base
                ).toString();

                const direct = this.direct(url);

                if (direct) {
                    return direct;
                }
            } catch {}
        }

        return null;
    }

    async resolve(link, retry = false) {
        if (
            !retry &&
            this.saved[link] &&
            this.direct(this.saved[link])
        ) {
            return this.direct(this.saved[link]);
        }

        if (!retry && this.cache.has(link)) {
            return this.cache.get(link);
        }

        if (this.pending.has(link)) {
            return this.pending.get(link);
        }

        const task = this.resolveNetwork(link)
            .then(result => {
                if (result) {
                    this.cache.set(link, result);
                }

                return result;
            })
            .catch(error => {
                console.warn(
                    "[FacebookVideoPlayer] Could not resolve:",
                    error
                );

                return null;
            })
            .finally(() => {
                this.pending.delete(link);
            });

        this.pending.set(link, task);

        return task;
    }

    async resolveNetwork(link) {
        if (!BdApi.Net?.fetch) {
            return null;
        }

        const urls = [link];
        const initial = new URL(link);

        if (
            initial.hostname !== "fb.watch" &&
            initial.hostname !== "www.fb.watch"
        ) {
            for (const host of [
                "www.facebook.com",
                "m.facebook.com",
                "web.facebook.com"
            ]) {
                const other = new URL(link);
                other.hostname = host;

                if (!urls.includes(other.toString())) {
                    urls.push(other.toString());
                }
            }
        }

        for (const target of urls) {
            if (!this.enabled) {
                return null;
            }

            try {
                const response = await BdApi.Net.fetch(
                    target,
                    {
                        method: "GET",
                        redirect: "follow",
                        timeout: 9000
                    }
                );

                const redirected = this.direct(
                    response.url || ""
                );

                if (redirected) {
                    return redirected;
                }

                const found = this.extract(
                    await response.text(),
                    response.url || target
                );

                if (found) {
                    return found;
                }
            } catch (error) {
                console.debug(
                    "[FacebookVideoPlayer] Resolve failed:",
                    target,
                    error
                );
            }
        }

        return null;
    }

    scan() {
        if (!this.enabled) {
            return;
        }

        const links = document.querySelectorAll(
            'a[href*="facebook.com/"], ' +
            'a[href*="fb.watch/"]'
        );

        for (const anchor of links) {
            if (anchor.closest(".sf-fb-card")) {
                continue;
            }

            const content = anchor.closest(
                '[id^="message-content-"], ' +
                '[class*="messageContent_"]'
            );

            if (!content?.isConnected) {
                continue;
            }

            const parsed = this.parse(anchor.href);

            if (!parsed) {
                continue;
            }

            const parent = content.parentElement;

            if (!parent) {
                continue;
            }

            const existing = [
                ...parent.querySelectorAll(".sf-fb-card")
            ].some(card =>
                card.dataset.link === parsed.url
            );

            if (existing) {
                continue;
            }

            const card =
                document.createElement("div");

            card.className = "sf-fb-card";
            card.dataset.link = parsed.url;

            if (parsed.reel) {
                card.classList.add("sf-fb-reel");
            }

            const header =
                document.createElement("div");

            header.className = "sf-fb-head";

            const title =
                document.createElement("span");

            title.textContent = parsed.reel
                ? "Facebook Reel"
                : "Facebook video";

            const open =
                document.createElement("a");

            open.href = parsed.url;
            open.target = "_blank";
            open.rel = "noopener noreferrer";
            open.textContent = "Open on Facebook ↗";

            header.append(title, open);
            card.append(header);

            content.insertAdjacentElement(
                "afterend",
                card
            );

            if (parsed.share) {
                this.loadShare(card, parsed.url);
            } else {
                this.showPlayer(card, parsed.url);
            }
        }

        this.hideNativePreviews();
    }

    hideNativePreviews() {
        const cards =
            document.querySelectorAll(".sf-fb-card");

        const activePreviews = new Set();

        for (const card of cards) {
            const message =
                card.closest(
                    '[id^="chat-messages-"]'
                ) ||
                card.closest(
                    'li[id*="chat-messages-"]'
                ) ||
                card.closest(
                    '[class*="messageListItem"]'
                );

            if (!message) {
                continue;
            }

            const embeds = message.querySelectorAll(
                '[class*="embedWrapper"], ' +
                '[class*="embedFull"]'
            );

            for (const embed of embeds) {
                if (embed.closest(".sf-fb-card")) {
                    continue;
                }

                const urls = [
                    ...embed.querySelectorAll("a[href]")
                ];

                const isFacebook = urls.some(anchor => {
                    try {
                        const host = new URL(
                            anchor.href
                        ).hostname.toLowerCase();

                        return (
                            host === "facebook.com" ||
                            host.endsWith(".facebook.com") ||
                            host === "fb.watch" ||
                            host === "www.fb.watch"
                        );
                    } catch {
                        return false;
                    }
                });

                if (isFacebook) {
                    activePreviews.add(embed);
                }
            }
        }

        for (const old of document.querySelectorAll(
            ".sf-fb-native-hidden"
        )) {
            if (!activePreviews.has(old)) {
                old.classList.remove(
                    "sf-fb-native-hidden"
                );
            }
        }

        for (const embed of activePreviews) {
            embed.classList.add(
                "sf-fb-native-hidden"
            );
        }
    }

    clear(card) {
        card.querySelectorAll(
            ".sf-fb-message, " +
            ".sf-fb-buttons, " +
            ".sf-fb-input, " +
            ".sf-fb-frame-wrapper"
        ).forEach(element => element.remove());
    }

    note(card, message) {
        this.clear(card);

        const element =
            document.createElement("div");

        element.className = "sf-fb-message";
        element.textContent = message;

        card.append(element);
    }

    showPlayer(card, link) {
        if (!this.enabled || !card.isConnected) {
            return;
        }

        const videoUrl = this.direct(link);

        if (!videoUrl) {
            this.note(card, "Invalid video link.");
            return;
        }

        const parsed = this.parse(videoUrl);

        card.classList.toggle(
            "sf-fb-reel",
            Boolean(parsed.reel)
        );

        const title =
            card.querySelector(".sf-fb-head span");

        if (title) {
            title.textContent = parsed.reel
                ? "Facebook Reel"
                : "Facebook video";
        }

        this.clear(card);

        const embed = new URL(
            "https://www.facebook.com/plugins/video.php"
        );

        embed.searchParams.set(
            "href",
            videoUrl
        );

        embed.searchParams.set(
            "show_text",
            "false"
        );

        embed.searchParams.set(
            "width",
            parsed.reel ? "390" : "560"
        );

        const wrapper =
            document.createElement("div");

        wrapper.className =
            "sf-fb-frame-wrapper";

        const iframe =
            document.createElement("iframe");

        iframe.src = embed.toString();

        iframe.title = parsed.reel
            ? "Facebook Reel"
            : "Facebook video player";

        iframe.loading = "lazy";

        iframe.allow =
            "autoplay; encrypted-media; " +
            "picture-in-picture; web-share";

        iframe.allowFullscreen = true;

        iframe.referrerPolicy =
            "strict-origin-when-cross-origin";

        wrapper.append(iframe);
        card.append(wrapper);
    }

    showFallback(card, share) {
        if (!this.enabled || !card.isConnected) {
            return;
        }

        this.note(
            card,
            "Facebook did not provide a direct video URL. " +
            "Try again or enter a direct link."
        );

        const buttons =
            document.createElement("div");

        buttons.className = "sf-fb-buttons";

        const retry =
            document.createElement("button");

        retry.textContent = "Try again";

        retry.onclick = () => {
            this.loadShare(card, share, true);
        };

        const manual =
            document.createElement("button");

        manual.textContent = "Enter direct link";

        manual.onclick = () => {
            if (card.querySelector(".sf-fb-input")) {
                return;
            }

            const input =
                document.createElement("input");

            input.className = "sf-fb-input";
            input.type = "url";

            input.placeholder =
                "https://www.facebook.com/reel/123456789/";

            const save =
                document.createElement("button");

            save.textContent = "Save and play";

            const saveAction = () => {
                const direct = this.direct(
                    input.value.trim()
                );

                if (!direct) {
                    input.setCustomValidity(
                        "Enter a direct Facebook Reel, " +
                        "Watch, or video link."
                    );

                    input.reportValidity();
                    return;
                }

                input.setCustomValidity("");

                this.saved[share] = direct;
                this.cache.set(share, direct);

                BdApi.Data.save(
                    "FacebookVideoPlayer",
                    "resolvedLinks",
                    this.saved
                );

                this.showPlayer(card, direct);
            };

            input.addEventListener(
                "input",
                () => input.setCustomValidity("")
            );

            input.addEventListener(
                "keydown",
                event => {
                    if (event.key === "Enter") {
                        saveAction();
                    }
                }
            );

            save.onclick = saveAction;

            card.insertBefore(input, buttons);
            buttons.append(save);

            input.focus();
        };

        buttons.append(retry, manual);
        card.append(buttons);
    }

    async loadShare(card, share, retry = false) {
        this.note(
            card,
            "Finding the direct video URL..."
        );

        const videoUrl = await this.resolve(
            share,
            retry
        );

        if (
            !this.enabled ||
            !card.isConnected ||
            card.dataset.link !== share
        ) {
            return;
        }

        if (videoUrl) {
            this.showPlayer(card, videoUrl);
        } else {
            this.showFallback(card, share);
        }
    }
};
