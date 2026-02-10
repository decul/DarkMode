class Modifier {
    // ===== Public API ==========================================================
    static addRecolorOverrides(opts = {}) {
        const {
            color = '#ffffff',          // target color (keeps original alpha)
            rgb = null,                 // or pass [r,g,b]
            styleId = 'byz-recolor',
            includeAdopted = true,
            includeShadowRoots = true,
            maxShadowRoots = 200,
            // computed fallback:
            alsoInline = true,
            maxElementsPerContext = 6000,
            observe = true              // watch for dynamically added overlays
        } = opts;

        const TARGET_RGB = rgb ? this.arrToRgb(rgb) : this.hexToRgb(color);

        // --- gather contexts (document + shadow roots) --------------------------
        const contexts = this.collectContexts({ styleId, includeAdopted, includeShadowRoots, maxShadowRoots });

        const result = {
            contexts: contexts.length,
            rulesScanned: 0,
            styleRulesMatched: 0,
            newRulesInserted: 0,
            sheetsSkipped: 0,
            inlineElementsTagged: 0,
            inlineRulesInserted: 0
        };

        // one Set per <style> to dedupe fallback rules across re-runs/observer
        const inlineSeen = new WeakMap();

        // --- pass 1: stylesheet-based overrides ---------------------------------
        for (const ctx of contexts) {
            const cssChunks = [];
            const seen = new Set(); // avoid duplicates in this context

            const visitRule = (rule) => {
                if ('cssRules' in rule && rule.cssRules?.length) {
                    for (const sub of Array.from(rule.cssRules)) visitRule(sub);
                    return;
                }
                if (rule.type !== CSSRule.STYLE_RULE || !rule.style) return;

                result.rulesScanned++;
                const s = rule.style;

                const candidates = [
                    ['background-color', true],
                    ['background', false],
                    ['background-image', false],
                ];

                const decls = [];
                for (const [prop, singleColorOnly] of candidates) {
                    const val = s.getPropertyValue(prop);
                    if (!val) continue;
                    if (!Modifier.hasSemiTransparentColor(val)) continue;

                    let newVal;
                    if (singleColorOnly) {
                        const a = Modifier.extractFirstAlpha(val);
                        if (a == null || a <= 0 || a >= 1) continue;
                        newVal = Modifier.rgbaString(TARGET_RGB, a);
                    } else {
                        const replaced = Modifier.recolorStringKeepingAlpha(val, TARGET_RGB);
                        if (replaced === val) continue;
                        newVal = replaced;
                    }

                    // keep or add !important so we win against atomic layers
                    const prio = s.getPropertyPriority(prop);
                    newVal += prio ? ' !important' : ' !important';
                    decls.push([prop, newVal]);
                }

                if (!decls.length) return;
                result.styleRulesMatched++;

                const orig = rule.selectorText.split(',');
                const prefixed = [];
                for (let sel of orig) {
                    sel = sel.trim();
                    if (!sel) continue;
                    if (ctx.type === 'document') {
                        prefixed.push(`html.byz-dark ${sel}`, `html[byz-dark] ${sel}`);
                    } else {
                        // inside shadow root
                        prefixed.push(`:host-context(html.byz-dark) ${sel}`, `:host-context(html[byz-dark]) ${sel}`);
                    }
                }
                if (!prefixed.length) return;

                const block = decls.map(([p, v]) => `${p}: ${v};`).join(' ');
                for (const psel of prefixed) {
                    const key = psel + '|' + block;
                    if (seen.has(key)) continue;
                    seen.add(key);
                    cssChunks.push(`${psel} { ${block} }`);
                    result.newRulesInserted++;
                }
            };

            for (const sheet of ctx.sheets) {
                let rules;
                try { rules = sheet.cssRules; } catch { result.sheetsSkipped++; continue; }
                if (!rules) continue;
                for (const r of Array.from(rules)) visitRule(r);
            }

            if (cssChunks.length) {
                ctx.styleEl.textContent = (ctx.styleEl.textContent || '') + '\n' + cssChunks.join('\n');
            }

            // --- pass 2: computed/inline fallback (optional) ----------------------
            if (alsoInline) {
                const { tagged, rules } = this.addInlineComputedOverridesForContext(
                    ctx, TARGET_RGB, inlineSeen, maxElementsPerContext
                );
                result.inlineElementsTagged += tagged;
                result.inlineRulesInserted += rules;
            }

            // --- observer for dynamic content ------------------------------------
            if (alsoInline && observe && !ctx.__byzObserver) {
                const schedule = this.makeScheduler(() => {
                    this.addInlineComputedOverridesForContext(ctx, TARGET_RGB, inlineSeen, maxElementsPerContext);
                });
                const obs = new MutationObserver((muts) => {
                    // re-scan only on added nodes / style/class attribute changes
                    for (const m of muts) {
                        if (m.type === 'childList' && (m.addedNodes?.length || m.removedNodes?.length)) {
                            schedule();
                            break;
                        }
                        if (m.type === 'attributes' && (m.attributeName === 'style' || m.attributeName === 'class')) {
                            schedule();
                            break;
                        }
                    }
                });
                obs.observe(ctx.root, { subtree: true, childList: true, attributes: true, attributeFilter: ['style','class'] });
                ctx.__byzObserver = obs;
            }
        }

        // some helpers for toggling
        return {
            ...result,
            enableDarkFlag() { document.documentElement.classList.add('byz-dark'); },
            disableDarkFlag() { document.documentElement.classList.remove('byz-dark'); document.documentElement.removeAttribute('byz-dark'); },
            setAttrFlag(v = true) { v ? document.documentElement.setAttribute('byz-dark', '') : document.documentElement.removeAttribute('byz-dark'); },
            removeAll() { for (const c of contexts) c.styleEl.remove(); },
        };
    }

    // ===== Fallback per-element (computed) ====================================
    static addInlineComputedOverridesForContext(ctx, TARGET_RGB, inlineSeen, maxElements) {
        const nodes = [];
        // Collect nodes efficiently
        // For ShadowRoot, querySelectorAll exists; for Document, too.
        // Cap to avoid runaway on huge pages.
        const all = ctx.root.querySelectorAll('*');
        const len = Math.min(all.length, maxElements);
        for (let i = 0; i < len; i++) nodes.push(all[i]);

        let tagged = 0;
        const chunks = [];
        const seen = inlineSeen.get(ctx.styleEl) || new Set();

        for (const el of nodes) {
            // fast bailouts for common invisible types
            const tag = el.tagName;
            if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'LINK' || tag === 'META' || tag === 'NOSCRIPT') continue;

            const cs = getComputedStyle(el);

            const decls = [];
            // 1) plain rgba() with alpha
            const m = /^\s*rgba\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d*\.?\d+)\s*\)\s*$/i.exec(cs.backgroundColor);
            if (m) {
                const a = parseFloat(m[4]);
                if (a > 0 && a < 1) {
                    decls.push(['background-color', `${this.rgbaString(TARGET_RGB, a)} !important`]);
                }
            }

            // 2) gradients or other background-image that carries alpha
            const bgImg = cs.backgroundImage;
            if (bgImg && /gradient/i.test(bgImg) && this.hasSemiTransparentColor(bgImg)) {
                const replaced = this.recolorStringKeepingAlpha(bgImg, TARGET_RGB);
                if (replaced !== bgImg) {
                    decls.push(['background-image', `${replaced} !important`]);
                }
            }

            if (!decls.length) continue;

            if (!el.hasAttribute('data-byz-uid')) {
                // reasonably unique per document; ok to collide across contexts
                el.setAttribute('data-byz-uid', Math.random().toString(36).slice(2, 9));
                tagged++;
            }
            const uid = el.getAttribute('data-byz-uid');

            const block = decls.map(([p, v]) => `${p}: ${v};`).join(' ');

            if (ctx.type === 'document') {
                const s1 = `html.byz-dark [data-byz-uid="${uid}"] { ${block} }`;
                const s2 = `html[byz-dark] [data-byz-uid="${uid}"] { ${block} }`;
                if (!seen.has(s1)) { chunks.push(s1); seen.add(s1); }
                if (!seen.has(s2)) { chunks.push(s2); seen.add(s2); }
            } else {
                const s1 = `:host-context(html.byz-dark) [data-byz-uid="${uid}"] { ${block} }`;
                const s2 = `:host-context(html[byz-dark]) [data-byz-uid="${uid}"] { ${block} }`;
                if (!seen.has(s1)) { chunks.push(s1); seen.add(s1); }
                if (!seen.has(s2)) { chunks.push(s2); seen.add(s2); }
            }
        }

        if (chunks.length) {
            ctx.styleEl.textContent = (ctx.styleEl.textContent || '') + '\n' + chunks.join('\n');
        }
        inlineSeen.set(ctx.styleEl, seen);

        return { tagged, rules: chunks.length };
    }

    // ===== Contexts (document + shadow roots) =================================
    static collectContexts({ styleId, includeAdopted, includeShadowRoots, maxShadowRoots }) {
        const contexts = [];

        // document context
        contexts.push({
            type: 'document',
            root: document,
            styleEl: this.ensureStyleEl(document, styleId),
            sheets: this.gatherSheets(document, includeAdopted),
        });

        if (includeShadowRoots) {
            let count = 0;
            for (const el of document.querySelectorAll('*')) {
                if (!el.shadowRoot) continue;
                if (count++ >= maxShadowRoots) break;
                const root = el.shadowRoot;
                contexts.push({
                    type: 'shadow',
                    root,
                    styleEl: this.ensureStyleEl(root, styleId),
                    sheets: this.gatherSheets(root, includeAdopted),
                });
            }
        }
        return contexts;
    }

    static gatherSheets(rootLike, includeAdopted) {
        const arr = [];
        try { arr.push(...Array.from(rootLike.styleSheets || [])); } catch {}
        if (includeAdopted && rootLike.adoptedStyleSheets) {
            try { arr.push(...Array.from(rootLike.adoptedStyleSheets)); } catch {}
        }
        return arr;
    }

    static ensureStyleEl(rootLike, id) {
        const doc = rootLike instanceof Document ? rootLike : rootLike.ownerDocument;
        let styleEl = (rootLike.getElementById ? rootLike.getElementById(id) : null);
        if (!styleEl && rootLike.querySelector) styleEl = rootLike.querySelector(`style#${CSS.escape(id)}`);
        if (!styleEl) {
            styleEl = doc.createElement('style');
            styleEl.id = id;
            styleEl.setAttribute('data-generated', 'byz-recolor');
            if (rootLike instanceof Document) rootLike.head.appendChild(styleEl);
            else rootLike.appendChild(styleEl);
        }
        return styleEl;
    }

    // ===== Small scheduler for observers ======================================
    static makeScheduler(fn) {
        let scheduled = false;
        return () => {
            if (scheduled) return;
            scheduled = true;
            requestAnimationFrame(() => { scheduled = false; fn(); });
        };
    }

    // ===== Color parsing / transforms =========================================
    static re = {
        rgbaComma: /rgba\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d*\.?\d+)\s*\)/gi,
        rgbSlash:  /rgb\(\s*(\d{1,3})\s+(\d{1,3})\s+(\d{1,3})\s*\/\s*(\d*\.?\d+)\s*\)/gi,
        hsla:      /hsla\(\s*([^,()]+)\s*,\s*([^,()]+)\s*,\s*([^,()]+)\s*,\s*(\d*\.?\d+)\s*\)/gi,
        hslSlash:  /hsl\(\s*[^/()]+\/\s*(\d*\.?\d+)\s*\)/gi,
        hex8:      /#([0-9a-fA-F]{8})\b/g,
        hex4:      /#([0-9a-fA-F]{4})\b/g,
    };

    static hasSemiTransparentColor(str) {
        if (this.matchAlphaBetween0and1(str, this.re.rgbaComma)) return true;
        if (this.matchAlphaBetween0and1(str, this.re.rgbSlash)) return true;
        if (this.matchAlphaBetween0and1(str, this.re.hsla)) return true;
        if (this.matchAlphaBetween0and1(str, this.re.hslSlash)) return true;

        let m = this.re.hex8.exec(str); this.re.hex8.lastIndex = 0;
        if (m) {
            const a = parseInt(m[1].slice(6, 8), 16) / 255;
            if (a > 0 && a < 1) return true;
        }
        m = this.re.hex4.exec(str); this.re.hex4.lastIndex = 0;
        if (m) {
            const a = parseInt(m[1].slice(3, 4) + m[1].slice(3, 4), 16) / 255;
            if (a > 0 && a < 1) return true;
        }
        return false;
    }

    static matchAlphaBetween0and1(str, regex) {
        regex.lastIndex = 0;
        let m;
        while ((m = regex.exec(str))) {
            const a = parseFloat(m[m.length - 1]);
            if (a > 0 && a < 1) return true;
        }
        return false;
    }

    static extractFirstAlpha(str) {
        for (const rx of [this.re.rgbaComma, this.re.rgbSlash, this.re.hsla, this.re.hslSlash]) {
            rx.lastIndex = 0;
            const m = rx.exec(str);
            if (m) {
                const a = parseFloat(m[m.length - 1]);
                if (!Number.isNaN(a)) return a;
            }
        }
        this.re.hex8.lastIndex = 0;
        let m = this.re.hex8.exec(str);
        if (m) return parseInt(m[1].slice(6, 8), 16) / 255;
        this.re.hex4.lastIndex = 0;
        m = this.re.hex4.exec(str);
        if (m) return parseInt(m[1].slice(3, 4) + m[1].slice(3, 4), 16) / 255;
        return null;
    }

    static recolorStringKeepingAlpha(str, NEW_RGB) {
        const toRgba = (_, a) => this.rgbaString(NEW_RGB, this.clamp01(parseFloat(a)));

        str = str.replace(this.re.rgbaComma, (_, _r, _g, _b, a) => toRgba(_, a));
        str = str.replace(this.re.rgbSlash,  (_, _r, _g, _b, a) => toRgba(_, a));
        str = str.replace(this.re.hsla,      () => {
            const args = arguments; const a = args[3]; return toRgba(null, a);
        });
        str = str.replace(this.re.hslSlash,  (_, a) => toRgba(_, a));

        str = str.replace(this.re.hex8, (_, hex) => {
            const a = parseInt(hex.slice(6, 8), 16) / 255;
            if (a <= 0 || a >= 1) return _;
            return this.rgbaString(NEW_RGB, a);
        });
        str = str.replace(this.re.hex4, (_, hex) => {
            const aNib = hex.slice(3, 4);
            const a = parseInt(aNib + aNib, 16) / 255;
            if (a <= 0 || a >= 1) return _;
            return this.rgbaString(NEW_RGB, a);
        });

        return str;
    }

    // ===== Helpers =============================================================
    static rgbaString({ r, g, b }, a) {
        return `rgba(${this.clamp255(r)}, ${this.clamp255(g)}, ${this.clamp255(b)}, ${this.clamp01(a)})`;
    }
    static hexToRgb(hex) {
        let h = hex.trim();
        if (h.startsWith('#')) h = h.slice(1);
        if (h.length === 3) h = h.split('').map(c => c + c).join('');
        if (h.length === 4) h = h.slice(0, 3).split('').map(c => c + c).join('') + 'ff';
        if (h.length === 6) return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16) };
        if (h.length === 8) return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16) };
        throw new Error(`Invalid HEX: ${hex}`);
    }
    static arrToRgb(a) {
        if (!Array.isArray(a) || a.length !== 3) throw new Error('rgb must be [r,g,b]');
        return { r: +a[0], g: +a[1], b: +a[2] };
    }
    static clamp255 = (n) => Math.max(0, Math.min(255, Math.round(n)));
    static clamp01 = (n) => Math.max(0, Math.min(1, +n));
}

// Example usage (same as before, now with options)
// Recolors to white, scans adopted stylesheets & shadow roots, adds computed fallback and observes DOM.
Modifier.addRecolorOverrides({
    color: '#ffffff',
    includeAdopted: true,
    includeShadowRoots: true,
    alsoInline: true,
    observe: true
});

// Toggle on/off:
// document.documentElement.classList.add('byz-dark');
// document.documentElement.setAttribute('byz-dark', '');
// document.documentElement.classList.remove('byz-dark');
// document.documentElement.removeAttribute('byz-dark');
