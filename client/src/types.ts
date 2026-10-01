
export interface NativeSource {
    id: string;
    name: string;
    kind: "screen" | "window";
    thumbnail: string;
    appIcon?: string;
}
