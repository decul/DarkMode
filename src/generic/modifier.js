// content.js
// Dodaje nowe reguły override dla półprzezroczystych teł z prefiksem:
// html.byz-dark <selector>, html[byz-dark] <selector>
(() => {
    'use strict';

    function addRecolorOverrides(opts = {}) {
        const {
            color = '#ff3b30',
            rgb = null,
            styleId = 'byz-recolor',
            includeAdopted = true,
            includeShadowRoots = true,
            maxShadowRoots = 200,        // safety cap
        } = opts;

        const NEW_RGB = rgb ? arrToRgb(rgb) : hexToRgb(color);

        // --- gather contexts (document + shadow roots) and their stylesheets
        const contexts = collectContexts({ styleId, includeAdopted, includeShadowRoots, maxShadowRoots });

        const result = {
            contexts: contexts.length,
            rulesScanned: 0,
            styleRulesMatched: 0,
            newRulesInserted: 0,
            sheetsSkipped: 0,
        };

        // process each context separately (so we can inject rules into that root)
        for (const ctx of contexts) {
            const cssChunks = [];
            const seen = new Set(); // unikaj duplikatów: key = selector||prop||value

            const visitRule = (styleRule) => {
                // grouping blocks (@media/@supports/@layer etc.)
                if ('cssRules' in styleRule && styleRule.cssRules?.length) {
                    for (const sub of Array.from(styleRule.cssRules)) visitRule(sub);
                    return;
                }
                if (styleRule.type !== CSSRule.STYLE_RULE || !styleRule.style) return;

                result.rulesScanned++;
                const s = styleRule.style;

                // Sprawdź potencjalne własności tła
                const candidates = [
                    ['background-color', true],
                    ['background', false],
                    ['background-image', false],
                ];

                let decls = [];

                for (const [prop, singleColorOnly] of candidates) {
                    const val = s.getPropertyValue(prop);
                    if (!val) continue;
                    if (!hasSemiTransparentColor(val)) continue;

                    let newVal;
                    if (singleColorOnly) {
                        const a = extractFirstAlpha(val);
                        if (a == null || a <= 0 || a >= 1) continue;
                        newVal = rgbaString(NEW_RGB, a);
                    } else {
                        const replaced = recolorStringKeepingAlpha(val, NEW_RGB);
                        if (replaced === val) continue;
                        newVal = replaced;
                    }

                    // Zachowaj !important jeśli było
                    const prio = s.getPropertyPriority(prop);
                    if (prio) newVal += ' !important';

                    decls.push([prop, newVal]);
                }

                if (!decls.length) return;

                result.styleRulesMatched++;

                // Rozbij selektory po przecinku i zbuduj z prefiksami html.byz-dark/attr
                const originalSelectors = styleRule.selectorText.split(',');
                const prefixedSelectors = [];
                for (let sel of originalSelectors) {
                    sel = sel.trim();
                    if (!sel) continue;
                    if (ctx.type === 'document') {
                        prefixedSelectors.push(`html.byz-dark ${sel}`);
                        prefixedSelectors.push(`html[byz-dark] ${sel}`);
                    } else {
                        // shadow root: inject inside the root using :host-context()
                        prefixedSelectors.push(`:host-context(html.byz-dark) ${sel}`);
                        prefixedSelectors.push(`:host-context(html[byz-dark]) ${sel}`);
                    }
                }

                if (prefixedSelectors.length === 0) return;

                // Uniknij duplikatów na poziomie (selector×decl)
                const block = decls
                    .map(([prop, val]) => `${prop}: ${val};`)
                    .join(' ');

                for (const prefSel of prefixedSelectors) {
                    const key = prefSel + '|' + block;
                    if (seen.has(key)) continue;
                    seen.add(key);
                    cssChunks.push(`${prefSel} { ${block} }`);
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
        }

        return {
            ...result,
            enableDarkFlag() {
                document.documentElement.classList.add('byz-dark');
            },
            disableDarkFlag() {
                document.documentElement.classList.remove('byz-dark');
                document.documentElement.removeAttribute('byz-dark');
            },
            setAttrFlag(v = true) {
                if (v) document.documentElement.setAttribute('byz-dark', '');
                else document.documentElement.removeAttribute('byz-dark');
            },
            removeAll() { 
                for (const c of contexts) c.styleEl.remove(); 
            },
        };
    }

    // -------- contexts (document + shadow roots) ----------
    function collectContexts({ styleId, includeAdopted, includeShadowRoots, maxShadowRoots }) {
        const contexts = [];

        // document context
        contexts.push({
            type: 'document',
            root: document,
            styleEl: ensureStyleEl(document, styleId),
            sheets: gatherSheets(document, includeAdopted),
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
                    styleEl: ensureStyleEl(root, styleId),
                    sheets: gatherSheets(root, includeAdopted),
                });
            }
        }
        return contexts;
    }

    function gatherSheets(rootLike, includeAdopted) {
        const arr = [];
        // styleSheets
        try { arr.push(...Array.from(rootLike.styleSheets || [])); } catch { }
        // adoptedStyleSheets
        if (includeAdopted && rootLike.adoptedStyleSheets) {
            try { arr.push(...Array.from(rootLike.adoptedStyleSheets)); } catch { }
        }
        return arr;
    }

    function ensureStyleEl(rootLike, id) {
        // rootLike: Document or ShadowRoot
        const doc = rootLike instanceof Document ? rootLike : rootLike.ownerDocument;
        let styleEl = (rootLike.getElementById ? rootLike.getElementById(id) : null);
        // ShadowRoot doesn’t implement getElementById; fallback:
        if (!styleEl && rootLike.querySelector) {
            styleEl = rootLike.querySelector(`style#${CSS.escape(id)}`);
        }
        if (!styleEl) {
            styleEl = doc.createElement('style');
            styleEl.id = id;
            styleEl.setAttribute('data-generated', 'byz-recolor');
            if (rootLike instanceof Document) rootLike.head.appendChild(styleEl);
            else rootLike.appendChild(styleEl);
        }
        return styleEl;
    }

    // -------- color detection & transforms ----------
    const re = {
        rgbaComma: /rgba\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d*\.?\d+)\s*\)/gi,
        rgbSlash: /rgb\(\s*(\d{1,3})\s+(\d{1,3})\s+(\d{1,3})\s*\/\s*(\d*\.?\d+)\s*\)/gi,
        hsla: /hsla\(\s*([^,()]+)\s*,\s*([^,()]+)\s*,\s*([^,()]+)\s*,\s*(\d*\.?\d+)\s*\)/gi,
        hslSlash: /hsl\(\s*[^/()]+\/\s*(\d*\.?\d+)\s*\)/gi,
        hex8: /#([0-9a-fA-F]{8})\b/g,
        hex4: /#([0-9a-fA-F]{4})\b/g,
    };

    function hasSemiTransparentColor(str) {
        if (matchAlphaBetween0and1(str, re.rgbaComma)) return true;
        if (matchAlphaBetween0and1(str, re.rgbSlash)) return true;
        if (matchAlphaBetween0and1(str, re.hsla)) return true;
        if (matchAlphaBetween0and1(str, re.hslSlash)) return true;

        let m = re.hex8.exec(str); re.hex8.lastIndex = 0;
        if (m) {
            const a = parseInt(m[1].slice(6, 8), 16) / 255;
            if (a > 0 && a < 1) return true;
        }
        m = re.hex4.exec(str); re.hex4.lastIndex = 0;
        if (m) {
            const a = parseInt(m[1].slice(3, 4) + m[1].slice(3, 4), 16) / 255;
            if (a > 0 && a < 1) return true;
        }
        return false;
    }

    function matchAlphaBetween0and1(str, regex) {
        regex.lastIndex = 0;
        let m;
        while ((m = regex.exec(str))) {
            const a = parseFloat(m[m.length - 1]);
            if (a > 0 && a < 1) return true;
        }
        return false;
    }

    function extractFirstAlpha(str) {
        for (const rx of [re.rgbaComma, re.rgbSlash, re.hsla, re.hslSlash]) {
            rx.lastIndex = 0;
            const m = rx.exec(str);
            if (m) {
                const a = parseFloat(m[m.length - 1]);
                if (!Number.isNaN(a)) return a;
            }
        }
        re.hex8.lastIndex = 0;
        let m = re.hex8.exec(str);
        if (m) return parseInt(m[1].slice(6, 8), 16) / 255;
        re.hex4.lastIndex = 0;
        m = re.hex4.exec(str);
        if (m) return parseInt(m[1].slice(3, 4) + m[1].slice(3, 4), 16) / 255;
        return null;
    }

    function recolorStringKeepingAlpha(str, NEW_RGB) {
        const toRgba = (_, a) => rgbaString(NEW_RGB, clamp01(parseFloat(a)));

        str = str.replace(re.rgbaComma, (_, _r, _g, _b, a) => toRgba(_, a));
        str = str.replace(re.rgbSlash, (_, _r, _g, _b, a) => toRgba(_, a));
        str = str.replace(re.hsla, () => {
            const args = arguments; // (..., a, idx, input)
            const a = args[3];
            return toRgba(null, a);
        });
        str = str.replace(re.hslSlash, (_, a) => toRgba(_, a));

        str = str.replace(re.hex8, (_, hex) => {
            const a = parseInt(hex.slice(6, 8), 16) / 255;
            if (a <= 0 || a >= 1) return _;
            return rgbaString(NEW_RGB, a);
        });
        str = str.replace(re.hex4, (_, hex) => {
            const aNib = hex.slice(3, 4);
            const a = parseInt(aNib + aNib, 16) / 255;
            if (a <= 0 || a >= 1) return _;
            return rgbaString(NEW_RGB, a);
        });

        return str;
    }

    // ==== utils kolorów ====
    function rgbaString({ r, g, b }, a) {
        return `rgba(${clamp255(r)}, ${clamp255(g)}, ${clamp255(b)}, ${clamp01(a)})`;
    }
    function hexToRgb(hex) {
        let h = hex.trim();
        if (h.startsWith('#')) h = h.slice(1);
        if (h.length === 3) h = h.split('').map(c => c + c).join('');
        if (h.length === 4) h = h.slice(0, 3).split('').map(c => c + c).join('') + 'ff';
        if (h.length === 6) return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16) };
        if (h.length === 8) return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16) };
        throw new Error(`Niepoprawny HEX: ${hex}`);
    }
    function arrToRgb(a) {
        if (!Array.isArray(a) || a.length !== 3) throw new Error('rgb musi być [r,g,b]');
        return { r: +a[0], g: +a[1], b: +a[2] };
    }
    const clamp255 = (n) => Math.max(0, Math.min(255, Math.round(n)));
    const clamp01 = (n) => Math.max(0, Math.min(1, +n));

    // Eksport
    window.addRecolorOverrides = addRecolorOverrides;
})();
