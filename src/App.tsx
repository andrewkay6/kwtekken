import Lenis from "lenis";
import Snap from "lenis/snap";
import { useEffect, useState } from "react";
import eventsJson from "../public/events.json";
import videosJson from "../public/videos.json";
import { photoSections } from "./content/photos";

type TournamentInfo = {
  name: string;
  slug: string;
  startAt: number | null;
  endAt: number | null;
  venueAddress: string;
  city: string;
  region: string;
  countryCode: string;
  embedTitle?: string | null;
  embedDescription?: string | null;
  embedImageUrl?: string | null;
};

type SceneEvent = {
  id: number | string;
  name: string;
  slug?: string;
  startAt: number | null;
  numEntrants?: number | null;
  videogame?: string;
};

type EventFeed = {
  sourceUrl: string;
  generatedAt: string | null;
  tournament: TournamentInfo;
  events: SceneEvent[];
};

type EventsFile = {
  sourceUrl?: string | null;
  generatedAt?: string | null;
  tournament?: Partial<TournamentInfo> | null;
  events?: SceneEvent[] | null;
};

type VideosFile = {
  generatedAt?: string | null;
  playlistId?: string | null;
  playlistTitle?: string | null;
  videoIds?: string[] | null;
};

type PageId = "home" | "photos";
type SectionId = "top" | "events";
type IconName = "discord" | "youtube" | "twitch" | "email";

const DISCORD_URL = "https://discord.gg/mCwGVgjXED";
const TWITCH_URL = "https://twitch.tv/kwtekken";
const YOUTUBE_URL = "https://www.youtube.com/@KWTekken";
const EMAIL_ADDRESS = "kwtekken@gmail.com";
const STARTGG_BASE_URL = "https://www.start.gg";
const LAST_YOUTUBE_VIDEO_KEY = "kwtekken:lastYoutubeVideoId";
const SECTION_IDS: SectionId[] = ["top", "events"];

const eventsFile = eventsJson as unknown as EventsFile;
const videosFile = videosJson as unknown as VideosFile;

// `npm run update` regenerates these two files from the start.gg and YouTube
// APIs; the browser only ever reads the checked-in display data, so no API
// credential is reachable from the bundle.
const feed: EventFeed = {
  sourceUrl: eventsFile.sourceUrl || STARTGG_BASE_URL,
  generatedAt: eventsFile.generatedAt ?? null,
  tournament: {
    name: eventsFile.tournament?.name ?? "",
    slug: eventsFile.tournament?.slug ?? "",
    startAt: eventsFile.tournament?.startAt ?? null,
    endAt: eventsFile.tournament?.endAt ?? null,
    venueAddress: eventsFile.tournament?.venueAddress ?? "",
    city: eventsFile.tournament?.city ?? "",
    region: eventsFile.tournament?.region ?? "",
    countryCode: eventsFile.tournament?.countryCode ?? "",
    embedTitle: eventsFile.tournament?.embedTitle ?? null,
    embedDescription: eventsFile.tournament?.embedDescription ?? null,
    embedImageUrl: eventsFile.tournament?.embedImageUrl ?? null,
  },
  events: eventsFile.events ?? [],
};

const youtubePlaylistId = videosFile.playlistId ?? "";
const youtubeVideoIds = Array.isArray(videosFile.videoIds)
  ? videosFile.videoIds.filter((videoId) => typeof videoId === "string" && videoId !== "")
  : [];

function formatDate(timestamp: number | null) {
  if (!timestamp) return "Date TBA";

  return new Intl.DateTimeFormat("en-CA", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(timestamp * 1000));
}

function isTodayOrEarlier(timestamp: number | null) {
  if (!timestamp) return false;

  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(0, 0, 0, 0);

  return timestamp * 1000 < tomorrow.getTime();
}
function externalLinkProps() {
  return {
    "data-tooltip": "Opens in new tab",
    rel: "noreferrer",
    target: "_blank",
  };
}

function currentPageFromHash(): PageId {
  return window.location.hash === "#photos" ? "photos" : "home";
}

function Icon({ name }: { name: IconName }) {
  if (name === "discord") {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24">
        <path d="M7.2 7.1c1.3-.8 3-1.2 4.8-1.2s3.5.4 4.8 1.2c1.4 2.5 1.9 5.3 1.6 8.1-1 .9-2.1 1.5-3.4 1.9l-.9-1.6c-1.4.4-2.8.4-4.2 0L9 17.1c-1.3-.4-2.4-1-3.4-1.9-.3-2.8.2-5.6 1.6-8.1Z" fill="none" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.8" />
        <path d="M9.4 11.5a1 1 0 1 1 2 0 1 1 0 0 1-2 0Zm3.2 0a1 1 0 1 1 2 0 1 1 0 0 1-2 0Z" fill="currentColor" />
        <path d="M9.6 14.4c1.6.7 3.2.7 4.8 0" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.4" />
      </svg>
    );
  }

  if (name === "youtube") {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24">
        <path d="M4.4 8.2c.2-1.4 1.1-2.3 2.5-2.5 3.4-.3 6.8-.3 10.2 0 1.4.2 2.3 1.1 2.5 2.5.3 2.5.3 5.1 0 7.6-.2 1.4-1.1 2.3-2.5 2.5-3.4.3-6.8.3-10.2 0-1.4-.2-2.3-1.1-2.5-2.5-.3-2.5-.3-5.1 0-7.6Z" fill="none" stroke="currentColor" strokeWidth="1.8" />
        <path d="m10.2 8.8 5 3.2-5 3.2V8.8Z" fill="currentColor" />
      </svg>
    );
  }

  if (name === "twitch") {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24">
        <path d="M6.4 4.5h12.1v8.4l-3.4 3.4h-3l-2.6 2.6v-2.6H5.4V7.1l1-2.6Z" fill="none" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.8" />
        <path d="M10.2 8.4v4.1M14.4 8.4v4.1" stroke="currentColor" strokeLinecap="square" strokeWidth="1.8" />
      </svg>
    );
  }

  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="M4.5 7.2h15v9.6h-15V7.2Z" fill="none" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.8" />
      <path d="m5.3 8 6.7 5.2L18.7 8" fill="none" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.8" />
    </svg>
  );
}

function selectRandomYoutubeVideoId(videoIds: string[]): string | null {
  if (videoIds.length === 0) return null;

  const lastVideoId =
    typeof window === "undefined"
      ? null
      : window.localStorage.getItem(LAST_YOUTUBE_VIDEO_KEY);
  const candidateVideos =
    videoIds.length > 1
      ? videoIds.filter((videoId) => videoId !== lastVideoId)
      : videoIds;

  return candidateVideos[Math.floor(Math.random() * candidateVideos.length)];
}

async function writeClipboardText(text: string) {
  if (window.navigator.clipboard) {
    await window.navigator.clipboard.writeText(text);
    return;
  }

  const textArea = document.createElement("textarea");
  textArea.value = text;
  textArea.style.left = "-9999px";
  textArea.style.position = "fixed";
  document.body.append(textArea);
  textArea.focus();
  textArea.select();
  document.execCommand("copy");
  textArea.remove();
}

function App() {
  const [emailCopyState, setEmailCopyState] = useState<"idle" | "copied">(
    "idle",
  );
  const [activePage, setActivePage] = useState<PageId>(currentPageFromHash);
  const [activeSection, setActiveSection] = useState<SectionId>("top");
  const [previewPhotoUrl, setPreviewPhotoUrl] = useState<string | null>(null);
  const [youtubeVideoId] = useState<string | null>(() =>
    selectRandomYoutubeVideoId(youtubeVideoIds),
  );

  useEffect(() => {
    if (!youtubeVideoId) return;

    window.localStorage.setItem(LAST_YOUTUBE_VIDEO_KEY, youtubeVideoId);
  }, [youtubeVideoId]);

  useEffect(() => {
    if (!previewPhotoUrl) return;

    const closePreview = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setPreviewPhotoUrl(null);
      }
    };

    window.addEventListener("keydown", closePreview);

    return () => {
      window.removeEventListener("keydown", closePreview);
    };
  }, [previewPhotoUrl]);

  useEffect(() => {
    const updateActivePage = () => {
      setActivePage(currentPageFromHash());
    };

    updateActivePage();
    window.addEventListener("hashchange", updateActivePage);

    return () => {
      window.removeEventListener("hashchange", updateActivePage);
    };
  }, []);

  useEffect(() => {
    if (activePage !== "home") return;

    const updateActiveSection = () => {
      let currentSection: SectionId = "top";
      const topbar = document.querySelector(".topbar");
      const activationLine =
        (topbar?.getBoundingClientRect().bottom || 0) + 24;

      for (const id of SECTION_IDS) {
        const section = document.getElementById(id);
        if (!section) continue;

        if (section.getBoundingClientRect().top <= activationLine) {
          currentSection = id;
        }
      }

      setActiveSection(currentSection);
    };
    const scrollContainer = document.querySelector("main");

    updateActiveSection();
    scrollContainer?.addEventListener("scroll", updateActiveSection, {
      passive: true,
    });
    window.addEventListener("scroll", updateActiveSection, { passive: true });
    window.addEventListener("resize", updateActiveSection);

    return () => {
      scrollContainer?.removeEventListener("scroll", updateActiveSection);
      window.removeEventListener("scroll", updateActiveSection);
      window.removeEventListener("resize", updateActiveSection);
    };
  }, [activePage]);

  useEffect(() => {
    if (activePage !== "home") return;

    const prefersReducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    );
    if (prefersReducedMotion.matches) return;

    const lenis = new Lenis({
      anchors: {
        duration: 1,
        lock: false,
      },
      autoRaf: true,
      duration: 1.15,
      smoothWheel: true,
      wheelMultiplier: 0.85,
    });
    const snap = new Snap(lenis, {
      debounce: 40,
      distanceThreshold: "100%",
      duration: 0.95,
      easing: (time) => 1 - Math.pow(1 - time, 3),
      lerp: 0.18,
      type: "lock",
    });
    const snapSections = SECTION_IDS.flatMap((id) => {
      const section = document.getElementById(id);
      return section ? [section] : [];
    });

    snap.addElements(snapSections, { align: "start" });

    return () => {
      snap.destroy();
      lenis.destroy();
    };
  }, [activePage]);

  const youtubeEmbedSrc =
    youtubeVideoId && youtubePlaylistId
      ? `https://www.youtube-nocookie.com/embed/${youtubeVideoId}?list=${youtubePlaylistId}&rel=0&vq=hd1440&hd=1`
      : "";
  const emailCopyLabel =
    emailCopyState === "copied" ? "Copied to clipboard" : "Click to copy";
  const shouldShowUpcomingNotice = isTodayOrEarlier(feed.tournament.startAt);

  const copyEmailAddress = async () => {
    try {
      await writeClipboardText(EMAIL_ADDRESS);
      setEmailCopyState("copied");
      window.setTimeout(() => setEmailCopyState("idle"), 1800);
    } catch {
      setEmailCopyState("idle");
    }
  };

  return (
    <main className={`page-${activePage}`}>
      <nav className="topbar" aria-label="Primary">
        <a className="wordmark" href="#top" aria-label="KW Tekken home">
          KW Tekken
        </a>
        <div className="page-links">
          <a
            aria-current={activePage === "home" ? "page" : undefined}
            href="#top"
          >
            Home
          </a>
          <a
            aria-current={activePage === "photos" ? "page" : undefined}
            href="#photos"
          >
            Photos
          </a>
        </div>
        <div className="quick-links">
          <a aria-label="Discord" href={DISCORD_URL} {...externalLinkProps()}>
            <Icon name="discord" />
            <span className="sr-only">Discord</span>
          </a>
          <a aria-label="YouTube" href={YOUTUBE_URL} {...externalLinkProps()}>
            <Icon name="youtube" />
            <span className="sr-only">YouTube</span>
          </a>
          <a aria-label="Twitch" href={TWITCH_URL} {...externalLinkProps()}>
            <Icon name="twitch" />
            <span className="sr-only">Twitch</span>
          </a>
          <button
            aria-label={`${emailCopyLabel}: ${EMAIL_ADDRESS}`}
            className="email-copy"
            data-tooltip={emailCopyLabel}
            onClick={copyEmailAddress}
            type="button"
          >
            <Icon name="email" />
            <span className="sr-only">
              {emailCopyState === "copied" ? "Copied" : "Email"}
            </span>
          </button>
        </div>
      </nav>

      {activePage === "home" ? (
        <>
          <nav className="section-dots" aria-label="Home sections">
            <a
              aria-label="Video section"
              aria-current={activeSection === "top" ? "true" : undefined}
              className={activeSection === "top" ? "active" : ""}
              href="#top"
            />
            <a
              aria-label="Events section"
              aria-current={activeSection === "events" ? "true" : undefined}
              className={activeSection === "events" ? "active" : ""}
              href="#events"
            />
          </nav>

          <section className="hero snap-section" id="top" aria-labelledby="page-title">
        <div className="hero-grid">
          <section className="video-panel" aria-label="KW Tekken VOD playlist">
            <h2>Tournament footage</h2>
            <div className="video-frame">
              {youtubeEmbedSrc ? (
                <iframe
                  key={youtubeVideoId}
                  title="KW Tekken VOD"
                  src={youtubeEmbedSrc}
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                  allowFullScreen
                />
              ) : (
                <a
                  className="button secondary video-frame-fallback"
                  href={YOUTUBE_URL}
                  {...externalLinkProps()}
                >
                  VODs coming soon - watch on YouTube
                </a>
              )}
            </div>
            {youtubeEmbedSrc && (
              <p className="video-quality-note">
                Tip: choose 1440p in the player settings for the clearest video.
              </p>
            )}
            <div className="video-actions">
              <a
                className="button primary"
                href={TWITCH_URL}
                {...externalLinkProps()}
              >
                Watch live on Twitch
              </a>
              <a
                className="button secondary"
                href={YOUTUBE_URL}
                {...externalLinkProps()}
              >
                YouTube channel
              </a>
            </div>
          </section>

          <div className="hero-copy">
            <p className="lede">
              Join our Discord for brackets, casuals, streams, and the next
              local.
            </p>
            <div className="hero-actions" aria-label="Community links">
              <a
                className="button primary"
                href={DISCORD_URL}
                {...externalLinkProps()}
              >
                Join Discord
              </a>
              <a className="button secondary" href="#events">
                See events
              </a>
              <a className="button secondary" href="#photos">
                See photos
              </a>
            </div>
          </div>
        </div>
          </section>

          <section className="section events-section snap-section" id="events">
        <div className="section-heading">
          <h2>Upcoming events</h2>
        </div>

        {shouldShowUpcomingNotice ? (
          <div className="event-feature">
            <div>
              <h3>Stay tuned for upcoming event announcements.</h3>
              <p>
                Join the{" "}
                <a
                  className="text-link"
                  href={DISCORD_URL}
                  rel="noreferrer"
                  target="_blank"
                >
                  Discord
                </a>{" "}
                for the latest KW Tekken local updates.
              </p>
            </div>
          </div>
        ) : (
          <a
            className={`event-feature startgg-embed ${
              feed.tournament.embedImageUrl ? "" : "startgg-embed-text-only"
            }`}
            href={feed.sourceUrl}
            {...externalLinkProps()}
          >
            {feed.tournament.embedImageUrl && (
              <img
                alt={`${feed.tournament.embedTitle || feed.tournament.name} preview`}
                className="startgg-embed-image"
                src={feed.tournament.embedImageUrl}
              />
            )}
            <div className="startgg-embed-body">
              <p className="startgg-domain">start.gg</p>
              <p className="event-date">{formatDate(feed.tournament.startAt)}</p>
              <p className="event-location">
                {feed.tournament.venueAddress ||
                  `${feed.tournament.city}${
                    feed.tournament.region ? `, ${feed.tournament.region}` : ""
                  }`}
              </p>
              <h3>{feed.tournament.embedTitle || feed.tournament.name}</h3>
              <p>
                {feed.tournament.embedDescription ||
                  `${feed.tournament.city}${
                    feed.tournament.region ? `, ${feed.tournament.region}` : ""
                  }`}
              </p>
              <span className="startgg-embed-action">View bracket details</span>
            </div>
          </a>
        )}
          </section>
        </>
      ) : (
        <section className="section photos-section photos-page" id="photos">
          <div className="section-heading">
            <h1>Event photos</h1>
          </div>

          {photoSections.map((section) => (
            <section
              aria-labelledby={`${section.id}-heading`}
              className="photo-gallery-section"
              key={section.id}
            >
              <div className="photo-gallery-heading">
                <h2 id={`${section.id}-heading`}>{section.title}</h2>
                {section.description && <p>{section.description}</p>}
              </div>

              <div
                aria-label={`${section.title} photo gallery`}
                className="photo-mosaic"
              >
                {section.photos.map((photo, index) => (
                  <figure className="photo-tile" key={photo.id}>
                    <button
                      aria-label={`Preview ${section.title} photo ${index + 1}`}
                      className="photo-preview-button"
                      onClick={() => setPreviewPhotoUrl(photo.src)}
                      type="button"
                    >
                      <img
                        alt={photo.alt}
                        className="event-photo"
                        loading="lazy"
                        src={photo.src}
                      />
                    </button>
                    {photo.caption && <figcaption>{photo.caption}</figcaption>}
                  </figure>
                ))}
              </div>
            </section>
          ))}
        </section>
      )}

      {previewPhotoUrl && (
        <div
          aria-label="Photo preview"
          aria-modal="true"
          className="photo-preview"
          onClick={() => setPreviewPhotoUrl(null)}
          role="dialog"
        >
          <button
            aria-label="Close photo preview"
            className="photo-preview-close"
            onClick={() => setPreviewPhotoUrl(null)}
            type="button"
          >
            <svg aria-hidden="true" viewBox="0 0 24 24">
              <path
                d="M6.75 6.75 17.25 17.25M17.25 6.75 6.75 17.25"
                fill="none"
                stroke="currentColor"
                strokeLinecap="round"
                strokeWidth="2.4"
              />
            </svg>
          </button>
          <img
            alt="Selected KW Tekken event photo"
            onClick={(event) => event.stopPropagation()}
            src={previewPhotoUrl}
          />
        </div>
      )}

    </main>
  );
}

export default App;
