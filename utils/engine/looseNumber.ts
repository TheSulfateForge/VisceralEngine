// ────────────────────────────────────────────────────────────────────────────
// v1.55: THE MODEL'S DURATIONS ARE OFTEN TEXT, NOT NUMBERS.
//
// DeepSeek V4.1 Flash (via OpenRouter) does not enforce the JSON schema's
// INTEGER type. It writes estimates the way a person would: "~20", "15-20",
// "about 30", "20 minutes", "an hour". validateResponse used Number(), which
// returns NaN for all of these, so time_passed_minutes fell back to 0 and the
// clock floor turned every such turn into +1m. In the 2026-11-11 Westcross
// save, dressing + brewing coffee, a garden walk, a second cup and sitting
// down to read each advanced the clock exactly one minute while the prose
// took the house from charcoal sky to full sun.
//
// parseLooseDuration reads the number a person meant. Ranges take the
// midpoint; a unit in the text converts to the field's unit.
// ────────────────────────────────────────────────────────────────────────────

const WORD_NUMBERS: Record<string, number> = {
    a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
    eleven: 11, twelve: 12, fifteen: 15, twenty: 20, thirty: 30, forty: 40, 'forty-five': 45, fifty: 50, sixty: 60,
    ninety: 90, half: 0.5, quarter: 0.25, few: 3, several: 4, couple: 2,
};

const NUM = String.raw`(\d+(?:\.\d+)?)`;

/**
 * Parse a duration the model wrote as a number or loose text.
 * `unit` is the field's unit: 'minutes' (time_passed_minutes,
 * travel_time_minutes) or 'hours' (sleep_hours).
 * Returns undefined when nothing numeric can be read.
 */
export const parseLooseDuration = (val: unknown, unit: 'minutes' | 'hours'): number | undefined => {
    if (typeof val === 'number') return Number.isFinite(val) ? val : undefined;
    if (typeof val !== 'string') return undefined;
    const s = val.toLowerCase().trim();
    if (!s) return undefined;
    if (!isNaN(Number(s))) return Number(s);

    // Value in the text's own unit, then converted to the field's unit.
    let n: number | undefined;
    const range = new RegExp(`${NUM}\\s*(?:-|–|—|to)\\s*${NUM}`).exec(s);
    if (range) {
        n = (parseFloat(range[1]) + parseFloat(range[2])) / 2;
    } else {
        const digit = new RegExp(NUM).exec(s);
        if (digit) {
            n = parseFloat(digit[1]);
        } else {
            // "half an hour", "a quarter hour", "an hour and a half", "twenty minutes"
            if (/\bhalf\s+an?\s+hour\b/.test(s)) return unit === 'minutes' ? 30 : 0.5;
            if (/\bquarter\s+(?:of\s+)?an?\s+hour\b|\ba\s+quarter\s+hour\b/.test(s)) return unit === 'minutes' ? 15 : 0.25;
            const word = /\b(an?|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|forty-five|forty|fifty|sixty|ninety|few|several|couple)\b/.exec(s);
            if (word) n = WORD_NUMBERS[word[1]];
            if (n !== undefined && /\band\s+a\s+half\b/.test(s)) n += 0.5;
        }
    }
    if (n === undefined || !Number.isFinite(n)) return undefined;

    const saysHours = /\b(?:hours?|hrs?|h)\b/.test(s);
    const saysMinutes = /\b(?:minutes?|mins?|m)\b/.test(s);
    if (unit === 'minutes' && saysHours && !saysMinutes) n *= 60;
    if (unit === 'hours' && saysMinutes && !saysHours) n /= 60;
    return Math.round(n * 100) / 100;
};
