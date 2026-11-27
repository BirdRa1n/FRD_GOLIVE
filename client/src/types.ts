
export interface NativeSource {
    id: string;
    name: string;
    kind: "screen" | "window";
    thumbnail: string;
    appIcon?: string;
}

export interface ReleaseInfo {
    tag: string;
    name: string;
    /** Changelog em markdown (corpo da release no GitHub). */
    body: string;
    url: string;
    publishedAt: string;
}

export type ReleaseCheck =
    | { ok: true; releases: ReleaseInfo[]; }
    | { ok: false; error: string; };

export interface LogEntry {
    t: number;
    l: string;
    s: string;
    m: string;
}
