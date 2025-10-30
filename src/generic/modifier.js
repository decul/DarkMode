// content.js
// Dodaje nowe reguły override dla półprzezroczystych teł z prefiksem:
// html.byz-dark <selector>, html[byz-dark] <selector>
(() => {
    'use strict';

    function addRecolorOverrides(opts = {}) {
        const { color = '#ff3b30', rgb = null, styleId = 'byz-recolor' } = opts;
        const NEW_RGB = rgb ? arrToRgb(rgb) : hexToRgb(color);

        const result = {
            rulesScanned: 0,
            styleRulesMatched: 0,
            newRulesInserted: 0,
            sheetsSkipped: 0,
        };

        // Zbierz nowe reguły jako plain CSS (szybciej niż setProperty w pętli)
        const cssChunks = [];
        const seen = new Set(); // unikaj duplikatów: key = selector||prop||value

        for (const sheet of Array.from(document.styleSheets)) {
            let rules;
            try {
                rules = sheet.cssRules; // może wywalić SecurityError (CORS)
            } catch {
                result.sheetsSkipped++;
                continue;
            }
            if (!rules) continue;

            for (const rule of Array.from(rules)) {
                processRuleDeep(rule, (styleRule) => {
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

                    if (decls.length === 0) return;

                    result.styleRulesMatched++;

                    // Rozbij selektory po przecinku i zbuduj z prefiksami html.byz-dark/attr
                    const originalSelectors = styleRule.selectorText.split(',');
                    const prefixedSelectors = [];
                    for (let sel of originalSelectors) {
                        sel = sel.trim();
                        if (!sel) continue;
                        prefixedSelectors.push(`html.byz-dark ${sel}`);
                        prefixedSelectors.push(`html[byz-dark] ${sel}`);
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
                });
            }
        }

        // Wstrzyknij (albo podmień) <style id="byz-recolor">
        const cssText = cssChunks.join('\n');
        let styleEl = document.getElementById(styleId);
        if (!styleEl) {
            styleEl = document.createElement('style');
            styleEl.id = styleId;
            styleEl.setAttribute('data-generated', 'byz-recolor');
            document.head.appendChild(styleEl);
        }
        styleEl.textContent = cssText;

        // Zwróć statystyki i helpery toggle
        return {
            ...result,
            styleId,
            bytes: cssText.length,
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
            removeStyle() {
                const el = document.getElementById(styleId);
                if (el) el.remove();
            },
        };
    }

    // ==== traversal ====
    function processRuleDeep(rule, onStyleRule) {
        // Reguły grupujące (@media, @supports, @layer, @container itp.)
        if ('cssRules' in rule && rule.cssRules?.length) {
            for (const sub of Array.from(rule.cssRules)) {
                processRuleDeep(sub, onStyleRule);
            }
            return;
        }
        if (rule.type === CSSRule.STYLE_RULE && rule.style) {
            onStyleRule(rule);
        }
    }

    // ==== wykrywanie i zamiana kolorów z alfą ====
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

const res = addRecolorOverrides({ color: '#00bfff' });