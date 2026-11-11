import { describe, expect, it } from "vitest";
import { videoSource } from "@nootion/shared";

const player = (url: string, parent?: string) => {
  const s = videoSource(url, parent);
  return s?.kind === "player" ? s.embedUrl : s;
};

describe("video links", () => {
  it("play YouTube in its no-cookie player, start time and playlist kept", () => {
    expect(player("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBe("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ");
    expect(player("https://youtu.be/dQw4w9WgXcQ?t=1m30s")).toBe("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?start=90");
    expect(player("youtube.com/shorts/abcDEF12345")).toBe("https://www.youtube-nocookie.com/embed/abcDEF12345");
    expect(player("https://m.youtube.com/watch?v=dQw4w9WgXcQ&list=PL123_abc")).toBe("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?list=PL123_abc");
  });

  it("know Vimeo, Dailymotion, Loom, Google Drive, PeerTube and Twitch", () => {
    expect(player("https://vimeo.com/76979871")).toBe("https://player.vimeo.com/video/76979871");
    expect(player("https://vimeo.com/76979871/abc123")).toBe("https://player.vimeo.com/video/76979871?h=abc123");
    expect(player("https://www.dailymotion.com/video/x8abc12")).toBe("https://www.dailymotion.com/embed/video/x8abc12");
    expect(player("https://dai.ly/x8abc12")).toBe("https://www.dailymotion.com/embed/video/x8abc12");
    expect(player("https://www.loom.com/share/0123abcd4567ef")).toBe("https://www.loom.com/embed/0123abcd4567ef");
    expect(player("https://drive.google.com/file/d/1AbC-dEf_123/view?usp=sharing")).toBe("https://drive.google.com/file/d/1AbC-dEf_123/preview");
    expect(player("https://framatube.org/w/9c9de5e8-0a1e-484a-b099-e80766180a6d")).toBe(
      "https://framatube.org/videos/embed/9c9de5e8-0a1e-484a-b099-e80766180a6d",
    );
    expect(player("https://www.twitch.tv/videos/123456", "notes.example.org")).toBe("https://player.twitch.tv/?parent=notes.example.org&video=v123456");
  });

  it("play video files, attached or not", () => {
    expect(videoSource("/api/attachments/6f1c1f5e-1d2b-4c3a-9e8f-0123456789ab")).toEqual({
      kind: "file",
      url: "/api/attachments/6f1c1f5e-1d2b-4c3a-9e8f-0123456789ab",
    });
    expect(videoSource("/api/public/tok_123/attachments/6f1c1f5e-1d2b-4c3a-9e8f-0123456789ab")?.kind).toBe("file");
    expect(videoSource("https://cdn.example.org/clip.webm")).toEqual({ kind: "file", url: "https://cdn.example.org/clip.webm" });
  });

  it("never frame other addresses", () => {
    expect(videoSource("https://example.org/page")).toBeNull();
    expect(videoSource("javascript:alert(1)")).toBeNull();
    expect(videoSource("https://www.youtube.com/watch?v=<script>")).toBeNull();
    expect(videoSource("https://evil.example/embed?u=https://youtube.com/watch?v=dQw4w9WgXcQ")).toBeNull();
    expect(videoSource("")).toBeNull();
  });
});
