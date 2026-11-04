
export interface NativeSource {
    id: string;
    name: string;
    kind: "screen" | "window";
    thumbnail: string;
    appIcon?: string;
}

export interface LogEntry {
    t: number;
    l: string;
    s: string;
    m: string;
}
