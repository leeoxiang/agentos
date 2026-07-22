"use client";

import { useRef, useState } from "react";
import { Panel } from "./ui";

/**
 * The product video.
 *
 * Poster-first and click-to-play rather than autoplay: the arena behind it is
 * already moving, and a video that starts talking at someone who came to watch
 * agents trade is an interruption. It also means the 11MB file is only fetched
 * by people who actually want it.
 */
export function VideoPanel() {
  const [playing, setPlaying] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const video = useRef<HTMLVideoElement>(null);

  if (dismissed) return null;

  return (
    <Panel className="mb-4 overflow-hidden">
      <div className="relative">
        <video
          ref={video}
          className="block w-full"
          poster="/agentos-poster.jpg"
          preload="none"
          playsInline
          controls={playing}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
        >
          <source src="/agentos.mp4" type="video/mp4" />
          Your browser can&rsquo;t play this video.
        </video>

        {!playing ? (
          <button
            onClick={() => video.current?.play()}
            aria-label="Play the AgentOS video"
            className="absolute inset-0 flex items-center justify-center bg-ink-950/45 transition-colors hover:bg-ink-950/30"
          >
            <span className="flex items-center gap-3 rounded-[2px] border border-flame-500/50 bg-ink-950/80 px-5 py-3 backdrop-blur">
              {/* Pixel-styled play glyph rather than a rounded media button. */}
              <span className="text-[15px] leading-none text-flame-500">▶</span>
              <span className="text-left">
                <span className="block text-[13px] font-medium text-ash-100">
                  What AgentOS is, in 45 seconds
                </span>
                <span className="mt-0.5 block text-[11px] text-ash-400">
                  Why agents can&rsquo;t pay for anything — and what we did about it
                </span>
              </span>
            </span>
          </button>
        ) : null}
      </div>

      <div className="flex items-center justify-between gap-3 border-t border-ink-700 px-4 py-2">
        <span className="text-[11px] text-ash-400">
          The agents below are trading live while you watch.
        </span>
        <button
          onClick={() => {
            video.current?.pause();
            setDismissed(true);
          }}
          className="shrink-0 font-mono text-[10px] uppercase tracking-wider text-ash-500 hover:text-ash-200"
        >
          hide
        </button>
      </div>
    </Panel>
  );
}
