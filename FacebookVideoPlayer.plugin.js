/**
 * @name FacebookVideoPlayer
 * @author Simonfas
 * @description Plays Facebook videos and Reels in Discord, preserving aspect ratio when a playable video source is available.
 * @version 1.6.0
 */
module.exports = class FacebookVideoPlayer {
    constructor() {
        this.styleId = "FacebookVideoPlayer-Style";
        this.enabled = false;
        this.observer = null;
        this.raf = null;
        this.pending = new Map();
        this.resolved = new Map();
        this.saved = {};
    }

    start() {
        this.enabled = true;
        this.saved = BdApi.Data.load("FacebookVideoPlayer", "resolvedLinks") || {};
        BdApi.DOM.addStyle(this.styleId, `
            .sf-fb-native-hidden { display: none !important; }
            .sf-fb-card { box-sizing:border-box; width:min(560px,100%); margin:8px 0;
                overflow:hidden; border:1px solid var(--border-subtle,rgba(255,255,255,.13));
                border-radius:10px; background:var(--background-secondary,#242428); }
            .sf-fb-card.sf-fb-reel { width:min(390px,100%); }
            .sf-fb-head { display:flex; align-items:center; gap:10px; padding:9px 12px;
                color:var(--text-normal,#eee); font-size:13px; }
            .sf-fb-head strong { margin-right:auto; }
            .sf-fb-head a { color:var(--text-link,#79adff); text-decoration:none; font-size:12px; }
            .sf-fb-media { position:relative; width:100%; overflow:hidden; background:#000; }
            .sf-fb-media video { display:block; width:100%; max-height:75vh; height:auto;
                object-fit:contain; background:#000; }
            .sf-fb-media iframe { display:block; width:100%; border:0; background:#000; }
            .sf-fb-message { padding:12px; color:var(--text-muted,#aaa); font-size:12px; }
            .sf-fb-actions { display:flex; gap:8px; padding:0 12px 12px; flex-wrap:wrap; }
            .sf-fb-actions button { cursor:pointer; padding:7px 10px; border:0; border-radius:5px;
                color:var(--text-normal,#fff); background:var(--button-secondary-background,#45454d); }
            .sf-fb-input { box-sizing:border-box; width:calc(100% - 24px); margin:0 12px 8px;
                padding:8px; color:var(--text-normal,#fff); background:var(--input-background,#151519);
                border:1px solid var(--border-subtle,rgba(255,255,255,.18)); border-radius:5px; }
        `);
        this.scan();
        this.observer = new MutationObserver(() => this.scheduleScan());
        this.observer.observe(document.body, { childList:true, subtree:true });
    }

    stop() {
        this.enabled = false;
        this.observer?.disconnect();
        this.observer = null;
        if (this.raf !== null) cancelAnimationFrame(this.raf);
        this.raf = null;
        document.querySelectorAll(".sf-fb-card").forEach(x => x.remove());
        document.querySelectorAll(".sf-fb-native-hidden").forEach(x => x.classList.remove("sf-fb-native-hidden"));
        BdApi.DOM.removeStyle(this.styleId);
        this.pending.clear();
        this.resolved.clear();
    }

    scheduleScan() {
        if (!this.enabled || this.raf !== null) return;
        this.raf = requestAnimationFrame(() => { this.raf = null; this.scan(); });
    }

    parse(input) {
        let u;
        try { u = new URL(input); } catch { return null; }
        const host = u.hostname.toLowerCase();
        if (!['https:','http:'].includes(u.protocol) || u.username || u.password ||
            !(host === 'facebook.com' || host.endsWith('.facebook.com') || host === 'fb.watch')) return null;
        const p = u.pathname;
        const share = host === 'fb.watch' || /^\/share\/(?:r|v)\/[^/]+/i.test(p);
        const reel = p.match(/^\/reels?\/(\d+)\/?$/i);
        const watch = /^\/(?:watch\/?|video\.php)$/i.test(p) && /^\d+$/.test(u.searchParams.get('v') || '');
        const video = /^\/videos\/(?:[^/]+\/)?\d+\/?$/i.test(p);
        if (!share && !reel && !watch && !video) return null;
        if (share) { u.protocol='https:'; u.hash=''; return {url:u.toString(),share:true,reel:/^\/share\/r\//i.test(p)}; }
        if (reel) return {url:`https://www.facebook.com/reel/${reel[1]}/`,share:false,reel:true};
        if (watch) return {url:`https://www.facebook.com/watch/?v=${u.searchParams.get('v')}`,share:false,reel:false};
        return {url:`https://www.facebook.com${p}`,share:false,reel:false};
    }

    direct(url) { const p = this.parse(url); return p && !p.share ? p.url : null; }

    decode(str) {
        if (typeof str !== 'string') return '';
        return str.replace(/\\u0026/gi,'&').replace(/\\u002f/gi,'/')
            .replace(/\\\//g,'/').replace(/&amp;/gi,'&').replace(/&quot;/gi,'"')
            .replace(/&#39;/gi,"'");
    }

    extractPage(html, base) {
        const candidates = [];
        const videos = [];
        try {
            const doc = new DOMParser().parseFromString(html,'text/html');
            for (const s of ['meta[property="og:url"]','meta[name="twitter:url"]','link[rel="canonical"]']) {
                const e = doc.querySelector(s);
                if (e) candidates.push(e.getAttribute('content') || e.getAttribute('href'));
            }
            for (const s of ['meta[property="og:video:secure_url"]','meta[property="og:video"]',
                'meta[property="og:video:url"]','meta[name="twitter:player:stream"]']) {
                const e = doc.querySelector(s);
                if (e) videos.push(e.getAttribute('content'));
            }
            const refresh = doc.querySelector('meta[http-equiv="refresh"]')?.getAttribute('content');
            const match = refresh?.match(/url\s*=\s*['"]?([^'";]+)/i);
            if (match) candidates.push(match[1]);
        } catch {}
        const normalized = this.decode(html);
        const linkMatches = normalized.match(/https?:\/\/(?:www\.|m\.|web\.)?facebook\.com\/(?:reels?\/\d+|watch\/?\?v=\d+|[^\s"'<>]{1,120}\/videos\/\d+)/gi) || [];
        candidates.push(...linkMatches);
        for (const regex of [
            /"(?:browser_native_hd_url|browser_native_sd_url|playable_url_quality_hd|playable_url|hd_src|sd_src)"\s*:\s*"([^"\n]+)"/gi,
            /"(?:video_url|videoUrl)"\s*:\s*"([^"\n]+)"/gi
        ]) {
            for (const m of html.matchAll(regex)) videos.push(m[1]);
        }
        let direct = null;
        for (const raw of candidates) {
            try { direct = this.direct(new URL(this.decode(raw),base).toString()); if (direct) break; } catch {}
        }
        let source = null;
        for (const raw of videos) {
            try {
                const value = this.decode(raw);
                const u = new URL(value,base);
                const host = u.hostname.toLowerCase();
                if (u.protocol === 'https:' &&
                    (host === 'facebook.com' || host.endsWith('.facebook.com') ||
                     host === 'fbcdn.net' || host.endsWith('.fbcdn.net'))) {
                    source = u.toString(); break;
                }
            } catch {}
        }
        return {direct,source};
    }

    async fetchInfo(link, retry=false) {
        if (!retry && this.resolved.has(link)) return this.resolved.get(link);
        if (this.pending.has(link)) return this.pending.get(link);
        const job = this.fetchNetwork(link).then(info => {
            if (info) this.resolved.set(link,info);
            return info;
        }).catch(e => {
            console.debug('[FacebookVideoPlayer] Fetch failed:',e);
            return null;
        }).finally(() => this.pending.delete(link));
        this.pending.set(link,job);
        return job;
    }

    async fetchNetwork(link) {
        if (!BdApi.Net?.fetch) return null;
        const initial = new URL(link);
        const urls = [link];
        if (!initial.hostname.endsWith('fb.watch')) {
            for (const host of ['www.facebook.com','m.facebook.com','web.facebook.com']) {
                const other = new URL(link); other.hostname=host;
                if (!urls.includes(other.toString())) urls.push(other.toString());
            }
        }
        let found = {direct:null,source:null};
        for (const target of urls) {
            if (!this.enabled) break;
            try {
                const response = await BdApi.Net.fetch(target, {
                    method:'GET',redirect:'follow',timeout:9000
                });
                const redirected = this.direct(response.url || '');
                const page = this.extractPage(await response.text(), response.url || target);
                found.direct ||= redirected || page.direct;
                found.source ||= page.source;
                if (found.source) break;
            } catch (e) { console.debug('[FacebookVideoPlayer] Could not fetch',target,e); }
        }
        return found;
    }

    scan() {
        if (!this.enabled) return;
        for (const a of document.querySelectorAll('a[href*="facebook.com/"], a[href*="fb.watch/"]')) {
            if (a.closest('.sf-fb-card')) continue;
            const content = a.closest('[id^="message-content-"], [class*="messageContent_"]');
            const parsed = this.parse(a.href);
            if (!content?.isConnected || !parsed || !content.parentElement) continue;
            const parent = content.parentElement;
            if ([...parent.querySelectorAll('.sf-fb-card')].some(x => x.dataset.link === parsed.url)) continue;
            const card = document.createElement('div');
            card.className = 'sf-fb-card' + (parsed.reel ? ' sf-fb-reel' : '');
            card.dataset.link = parsed.url;
            const header = document.createElement('div'); header.className='sf-fb-head';
            const title = document.createElement('strong'); title.textContent=parsed.reel?'Facebook Reel':'Facebook video';
            const open = document.createElement('a');
            open.href=parsed.url; open.target='_blank'; open.rel='noopener noreferrer';
            open.textContent='Open on Facebook ↗';
            header.append(title,open); card.append(header);
            content.insertAdjacentElement('afterend',card);
            this.load(card,parsed.url);
        }
        this.hideNativePreviews();
    }

    hideNativePreviews() {
        const active = new Set();
        for (const card of document.querySelectorAll('.sf-fb-card')) {
            const msg = card.closest('[id^="chat-messages-"], li[id*="chat-messages-"], [class*="messageListItem"]');
            if (!msg) continue;
            for (const embed of msg.querySelectorAll('[class*="embedWrapper"], [class*="embedFull"]')) {
                if (embed.closest('.sf-fb-card')) continue;
                if ([...embed.querySelectorAll('a[href]')].some(a => this.parse(a.href))) active.add(embed);
            }
        }
        for (const el of document.querySelectorAll('.sf-fb-native-hidden')) {
            if (!active.has(el)) el.classList.remove('sf-fb-native-hidden');
        }
        for (const el of active) el.classList.add('sf-fb-native-hidden');
    }

    clear(card) { card.querySelectorAll('.sf-fb-media,.sf-fb-message,.sf-fb-actions,.sf-fb-input').forEach(e => e.remove()); }
    note(card,msg) { this.clear(card); const e=document.createElement('div');e.className='sf-fb-message';e.textContent=msg;card.append(e); }
    setLink(card,url) {
        const parsed=this.parse(url);
        if (!parsed) return;
        card.classList.toggle('sf-fb-reel',parsed.reel);
        card.querySelector('.sf-fb-head strong').textContent=parsed.reel?'Facebook Reel':'Facebook video';
        card.querySelector('.sf-fb-head a').href=url;
    }

    showVideo(card,url,source) {
        if (!this.enabled || !card.isConnected) return;
        this.clear(card);
        const frame=document.createElement('div');frame.className='sf-fb-media';
        const video=document.createElement('video');
        video.controls=true; video.playsInline=true; video.preload='metadata';
        video.setAttribute('controlsList','nodownload');
        video.style.aspectRatio='9 / 16';
        video.addEventListener('loadedmetadata',() => {
            if (video.videoWidth && video.videoHeight) {
                video.style.aspectRatio=`${video.videoWidth} / ${video.videoHeight}`;
            }
        });
        video.addEventListener('error',() => {
            if (card.isConnected && this.enabled) this.showEmbed(card,url);
        },{once:true});
        frame.append(video);card.append(frame);
        video.src=source;
    }

    
    showEmbed(card, url) {
        if (!this.enabled || !card.isConnected) return;

        this.clear(card);

        const parsed = this.parse(url);
        const isReel = Boolean(parsed?.reel);
        const width = isReel ? 390 : 560;
        const height = Math.round(width * 9 / 16);

        const frame = document.createElement("div");
        frame.className = "sf-fb-media";

        frame.style.width = "100%";
        frame.style.height = "auto";
        frame.style.aspectRatio = "16 / 9";
        frame.style.overflow = "hidden";
        frame.style.background = "#000";

        const iframe = document.createElement("iframe");

        const embed = new URL(
            "https://www.facebook.com/plugins/video.php"
        );

        embed.searchParams.set("href", url);
        embed.searchParams.set("show_text", "false");
        embed.searchParams.set("width", String(width));
        embed.searchParams.set("height", String(height));

        iframe.src = embed.toString();
        iframe.title = isReel
            ? "Facebook Reel"
            : "Facebook video";

        iframe.width = String(width);
        iframe.height = String(height);
        iframe.style.width = "100%";
        iframe.style.height = "100%";
        iframe.style.display = "block";
        iframe.style.border = "0";
        iframe.style.aspectRatio = "16 / 9";

        iframe.loading = "lazy";
        iframe.allow =
            "autoplay; encrypted-media; picture-in-picture; web-share";
        iframe.allowFullscreen = true;
        iframe.referrerPolicy = "strict-origin-when-cross-origin";

        frame.appendChild(iframe);
        card.appendChild(frame);
    }

    showManual(card,share) {
        if (!this.enabled || !card.isConnected) return;
        this.note(card,'Facebook could not resolve this share link.');
        const actions=document.createElement('div');actions.className='sf-fb-actions';
        const retry=document.createElement('button');retry.textContent='Try again';
        retry.onclick=() => this.load(card,share,true);
        const manual=document.createElement('button');manual.textContent='Enter direct link';
        manual.onclick=() => {
            if (card.querySelector('.sf-fb-input')) return;
            const input=document.createElement('input');input.className='sf-fb-input';input.type='url';
            input.placeholder='https://www.facebook.com/reel/123456789/';
            const save=document.createElement('button');save.textContent='Save and play';
            const submit=() => {
                const direct=this.direct(input.value.trim());
                if (!direct) { input.setCustomValidity('Enter a Facebook Reel or video URL.');input.reportValidity();return; }
                this.saved[share]=direct;
                BdApi.Data.save('FacebookVideoPlayer','resolvedLinks',this.saved);
                this.load(card,direct);
            };
            input.addEventListener('input',() => input.setCustomValidity(''));
            input.addEventListener('keydown',e => {if(e.key==='Enter') submit();});
            save.onclick=submit;card.insertBefore(input,actions);actions.append(save);input.focus();
        };
        actions.append(retry,manual);card.append(actions);
    }

    async load(card,link,retry=false) {
        const parsed=this.parse(link);
        if (!parsed || !this.enabled || !card.isConnected) return;
        this.note(card,'Loading video...');
        const saved=this.direct(this.saved[link]);
        const info=await this.fetchInfo(saved || link,retry);
        if (!this.enabled || !card.isConnected) return;
        const resolved=info?.direct || saved || this.direct(link);
        if (!resolved) return this.showManual(card,link);
        this.setLink(card,resolved);
        if (info?.source) this.showVideo(card,resolved,info.source);
        else this.showEmbed(card,resolved);
    }
};
