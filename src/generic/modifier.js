
class Modifier {
    'use strict';

    static addRecolorOverrides() {
        const styleId = 'byz-recolor';
        const BLACK = this.hexToRgb("#fff");

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

            if (!rules) 
                continue;

            for (const rule of Array.from(rules)) {
                this.processRuleDeep(rule, (styleRule) => {
                    result.rulesScanned++;
                    const style = styleRule.style;

                    // Sprawdź potencjalne własności tła
                    const candidates = [
                        ['background-color', true],
                        ['background', false],
                        ['background-image', false],
                    ];

                    let decls = [];

                    for (const [prop, singleColorOnly] of candidates) {
                        const val = style.getPropertyValue(prop);
                        if (!val) continue;
                        if (!this.hasSemiTransparentColor(val)) continue;

                        let newVal;
                        if (singleColorOnly) {
                            const a = this.extractFirstAlpha(val);
                            if (a == null || a <= 0 || a >= 1) continue;
                            newVal = this.rgbaString(BLACK, a);
                        } else {
                            const replaced = this.recolorStringKeepingAlpha(val, BLACK);
                            if (replaced === val) continue;
                            newVal = replaced;
                        }

                        // Zachowaj !important jeśli było
                        const prio = style.getPropertyPriority(prop);
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

        console.log(result);
    }

    // ==== traversal ====
    static processRuleDeep(rule, onStyleRule) {
        // Reguły grupujące (@media, @supports, @layer, @container itp.)
        if ('cssRules' in rule && rule.cssRules?.length) {
            for (const sub of Array.from(rule.cssRules)) {
                this.processRuleDeep(sub, onStyleRule);
            }
            return;
        }
        if (rule.type === CSSRule.STYLE_RULE && rule.style) {
            onStyleRule(rule);
        }
    }

    // ==== wykrywanie i zamiana kolorów z alfą ====
    static re = {
        rgbaComma: /rgba\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d*\.?\d+)\s*\)/gi,
        rgbSlash: /rgb\(\s*(\d{1,3})\s+(\d{1,3})\s+(\d{1,3})\s*\/\s*(\d*\.?\d+)\s*\)/gi,
        hsla: /hsla\(\s*([^,()]+)\s*,\s*([^,()]+)\s*,\s*([^,()]+)\s*,\s*(\d*\.?\d+)\s*\)/gi,
        hslSlash: /hsl\(\s*[^/()]+\/\s*(\d*\.?\d+)\s*\)/gi,
        hex8: /#([0-9a-fA-F]{8})\b/g,
        hex4: /#([0-9a-fA-F]{4})\b/g,
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
        str = str.replace(this.re.rgbSlash, (_, _r, _g, _b, a) => toRgba(_, a));
        str = str.replace(this.re.hsla, () => {
            const args = arguments; // (..., a, idx, input)
            const a = args[3];
            return toRgba(null, a);
        });
        str = str.replace(this.re.hslSlash, (_, a) => toRgba(_, a));

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

    // ==== utils kolorów ====
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
        throw new Error(`Niepoprawny HEX: ${hex}`);
    }
    static arrToRgb(a) {
        if (!Array.isArray(a) || a.length !== 3) throw new Error('rgb musi być [r,g,b]');
        return { r: +a[0], g: +a[1], b: +a[2] };
    }
    static clamp255 = (n) => Math.max(0, Math.min(255, Math.round(n)));
    static clamp01 = (n) => Math.max(0, Math.min(1, +n));

}

const res = Modifier.addRecolorOverrides();