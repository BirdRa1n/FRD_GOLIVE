const MAX_LINE = 4000;

const RULES: Array<[RegExp, string]> = [
    [/data:[\w.+-]+\/[\w.+-]+;base64,[A-Za-z0-9+/=_-]+/g, "[data-uri]"],
    [/"([^"]*(?:token|secret|password|authorization|session_?id)[^"]*)"\s*:\s*("(?:[^"\\]|\\.)*"|\[[^\]]*\])/gi, "\"$1\":\"[redacted]\""],
    [/\bmfa\.[\w-]{20,}/g, "[token]"],
    [/\b[\w-]{23,28}\.[\w-]{6,7}\.[\w-]{27,}/g, "[token]"],
    [/\b(Bearer|Bot)\s+[\w.-]{20,}/g, "$1 [token]"],
    [/([?&](?:token|access_token|code|key)=)[^&\s"]+/gi, "$1[redacted]"],
];

export function scrubLogLine(line: string): string {
    let out = line;
    for (const [re, to] of RULES) out = out.replace(re, to);
    return out.length > MAX_LINE ? `${out.slice(0, MAX_LINE)}…[+${out.length - MAX_LINE}]` : out;
}
