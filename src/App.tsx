import Lenis from "lenis";
import Snap from "lenis/snap";
import type { PointerEvent, TouchEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";

type TournamentInfo = {
  name: string;
  slug: string;
  startAt: number | null;
  endAt: number | null;
  venueAddress: string;
  city: string;
  region: string;
  countryCode: string;
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

type SectionId = "top" | "events" | "photos";
type IconName = "discord" | "youtube" | "twitch" | "email";
type SwipeDirection = "left" | "right";

const DISCORD_URL = "https://discord.gg/mCwGVgjXED";
const TWITCH_URL = "https://twitch.tv/kwtekken";
const YOUTUBE_URL = "https://www.youtube.com/@KWTekken";
const EMAIL_ADDRESS = "kwtekken@gmail.com";
const STARTGG_URL = "https://www.start.gg/tournament/basement-brawl-3-2/details";
const YOUTUBE_PLAYLIST_ID = "PLfv6rKhYEs1o";
const LAST_YOUTUBE_VIDEO_KEY = "kwtekken:lastYoutubeVideoId";
const YOUTUBE_PLAYLIST_VIDEO_IDS = [
  "gfSw34paue8",
  "_iqM0lNskP0",
  "va8B2Ppm7Fo",
  "HdsIXIbzhWU",
  "svO0WMGC5ok",
  "NlQIEfjDFXM",
  "9jx1xx3V1ec",
  "GkpklQ-7u70",
  "w6S4DhSHKnU",
  "SLQigl7qLZQ",
  "0Ojs2OjN_3A",
  "0VTtkYKWQbc",
  "zOgg7ssRYog",
  "UCKixTWXOM8",
  "4O5vUHFzcl8",
];
const SECTION_IDS: SectionId[] = ["top", "events", "photos"];
const photoPlaceholders = [
  {
    eventName: "Basement Brawl 2",
    caption: "June 24, 2026",
    src: "/event-photos/20260624_203608.webp",
  },
  {
    eventName: "Basement Brawl 2",
    caption: "June 24, 2026",
    src: "/event-photos/20260624_203626.webp",
  },
  {
    eventName: "Basement Brawl 3",
    caption: "July 8, 2026",
    src: "/event-photos/20260708_192104.webp",
  },
  {
    eventName: "Basement Brawl 3",
    caption: "July 8, 2026",
    src: "/event-photos/20260708_192115.webp",
  },
  {
    eventName: "Basement Brawl 3",
    caption: "July 8, 2026",
    src: "/event-photos/20260708_210208.webp",
  },
];

const fallbackFeed: EventFeed = {
  sourceUrl: STARTGG_URL,
  generatedAt: null,
  tournament: {
    name: "Basement Brawl 3",
    slug: "tournament/basement-brawl-3-2",
    startAt: 1784692800,
    endAt: null,
    venueAddress: "247 King St N Unit 8 Basement Level, Waterloo, ON N2J 2Y8, Canada",
    city: "Waterloo",
    region: "ON",
    countryCode: "CA",
  },
  events: [],
};

function formatDate(timestamp: number | null) {
  if (!timestamp) return "Date TBA";

  return new Intl.DateTimeFormat("en-CA", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(timestamp * 1000));
}

function formatShortDate(timestamp: number | null) {
  if (!timestamp) return "TBA";

  return new Intl.DateTimeFormat("en-CA", {
    month: "short",
    day: "numeric",
  }).format(new Date(timestamp * 1000));
}

function isTodayOrEarlier(timestamp: number | null) {
  if (!timestamp) return false;

  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(0, 0, 0, 0);

  return timestamp * 1000 < tomorrow.getTime();
}

function isAfterToday(timestamp: number | null) {
  if (!timestamp) return true;

  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(0, 0, 0, 0);

  return timestamp * 1000 >= tomorrow.getTime();
}

function eventUrl(event: SceneEvent) {
  if (!event.slug) return STARTGG_URL;
  return `https://www.start.gg/${event.slug}`;
}

function externalLinkProps() {
  return {
    "data-tooltip": "Opens in new tab",
    rel: "noreferrer",
    target: "_blank",
  };
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

function selectRandomYoutubeVideoId() {
  const lastVideoId =
    typeof window === "undefined"
      ? null
      : window.localStorage.getItem(LAST_YOUTUBE_VIDEO_KEY);
  const candidateVideos =
    YOUTUBE_PLAYLIST_VIDEO_IDS.length > 1
      ? YOUTUBE_PLAYLIST_VIDEO_IDS.filter((videoId) => videoId !== lastVideoId)
      : YOUTUBE_PLAYLIST_VIDEO_IDS;

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
  const [feed, setFeed] = useState<EventFeed>(fallbackFeed);
  const [emailCopyState, setEmailCopyState] = useState<"idle" | "copied">(
    "idle",
  );
  const [activeSection, setActiveSection] = useState<SectionId>("top");
  const [activePhotoIndex, setActivePhotoIndex] = useState(2);
  const [photoSwipe, setPhotoSwipe] = useState<{
    direction: SwipeDirection;
    progress: number;
  } | null>(null);
  const [youtubeVideoId] = useState(selectRandomYoutubeVideoId);
  const photoTouchStartX = useRef<number | null>(null);
  const photoPointerStartX = useRef<number | null>(null);
  const didDragPhoto = useRef(false);

  useEffect(() => {
    fetch("/events.json", { cache: "no-cache" })
      .then((response) => {
        if (!response.ok) throw new Error("Could not load events feed");
        return response.json() as Promise<EventFeed>;
      })
      .then((data) => {
        setFeed(data);
      })
      .catch(() => {
        setFeed(fallbackFeed);
      });
  }, []);

  useEffect(() => {
    window.localStorage.setItem(LAST_YOUTUBE_VIDEO_KEY, youtubeVideoId);
  }, [youtubeVideoId]);

  useEffect(() => {
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
  }, []);

  useEffect(() => {
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
  }, []);

  const sortedEvents = useMemo(
    () =>
      feed.events.filter((event) => isAfterToday(event.startAt)).sort((a, b) => {
        if (!a.startAt && !b.startAt) return a.name.localeCompare(b.name);
        if (!a.startAt) return 1;
        if (!b.startAt) return -1;
        return a.startAt - b.startAt;
      }),
    [feed.events],
  );

  const youtubeEmbedSrc = `https://www.youtube-nocookie.com/embed/${youtubeVideoId}?list=${YOUTUBE_PLAYLIST_ID}&rel=0`;
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
  const getPhotoOffset = (index: number) => {
    const photoCount = photoPlaceholders.length;
    const forwardOffset = (index - activePhotoIndex + photoCount) % photoCount;

    return forwardOffset > photoCount / 2
      ? forwardOffset - photoCount
      : forwardOffset;
  };

  const showPreviousPhoto = () => {
    setActivePhotoIndex(
      (currentIndex) =>
        (currentIndex - 1 + photoPlaceholders.length) %
        photoPlaceholders.length,
    );
  };

  const showNextPhoto = () => {
    setActivePhotoIndex(
      (currentIndex) => (currentIndex + 1) % photoPlaceholders.length,
    );
  };

  const handlePhotoTouchStart = (event: TouchEvent<HTMLDivElement>) => {
    photoTouchStartX.current = event.touches[0]?.clientX ?? null;
    setPhotoSwipe(null);
  };

  const cancelPhotoTouch = () => {
    photoTouchStartX.current = null;
    setPhotoSwipe(null);
  };

  const updatePhotoSwipeProgress = (deltaX: number) => {
    if (Math.abs(deltaX) < 8) {
      setPhotoSwipe(null);
      return;
    }

    setPhotoSwipe({
      direction: deltaX < 0 ? "left" : "right",
      progress: Math.min(Math.abs(deltaX) / 96, 1),
    });
  };

  const handlePhotoTouchMove = (event: TouchEvent<HTMLDivElement>) => {
    if (photoTouchStartX.current === null) return;

    const currentX = event.touches[0]?.clientX;
    if (typeof currentX !== "number") return;

    updatePhotoSwipeProgress(currentX - photoTouchStartX.current);
  };

  const handlePhotoTouchEnd = (event: TouchEvent<HTMLDivElement>) => {
    if (photoTouchStartX.current === null) return;

    const endX = event.changedTouches[0]?.clientX;
    if (typeof endX !== "number") {
      cancelPhotoTouch();
      return;
    }

    const deltaX = endX - photoTouchStartX.current;
    photoTouchStartX.current = null;
    setPhotoSwipe(null);

    if (Math.abs(deltaX) < 42) return;

    if (deltaX < 0) {
      showNextPhoto();
      return;
    }

    showPreviousPhoto();
  };

  const handlePhotoPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "touch") return;

    event.currentTarget.setPointerCapture(event.pointerId);
    photoPointerStartX.current = event.clientX;
    didDragPhoto.current = false;
    setPhotoSwipe(null);
  };

  const resetPhotoPointerPosition = () => {
    photoPointerStartX.current = null;
    setPhotoSwipe(null);
  };

  const cancelPhotoPointer = () => {
    resetPhotoPointerPosition();
    didDragPhoto.current = false;
  };

  const handlePhotoPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (photoPointerStartX.current === null) return;

    const deltaX = event.clientX - photoPointerStartX.current;

    updatePhotoSwipeProgress(deltaX);

    if (Math.abs(deltaX) > 8) {
      didDragPhoto.current = true;
    }
  };

  const handlePhotoPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    if (photoPointerStartX.current === null) return;

    const deltaX = event.clientX - photoPointerStartX.current;
    photoPointerStartX.current = null;
    setPhotoSwipe(null);

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    if (Math.abs(deltaX) < 48) {
      didDragPhoto.current = false;
      const target =
        document.elementFromPoint(event.clientX, event.clientY) ||
        (event.target as HTMLElement);
      const photoButton =
        target.closest<HTMLButtonElement>("[data-photo-index]");
      const photoIndex = Number(photoButton?.dataset.photoIndex);

      if (Number.isInteger(photoIndex)) {
        setActivePhotoIndex(photoIndex);
      }

      return;
    }

    if (deltaX < 0) {
      showNextPhoto();
      return;
    }

    showPreviousPhoto();
  };

  return (
    <main>
      <nav className="topbar" aria-label="Primary">
        <a className="wordmark" href="#top" aria-label="KW Tekken home">
          KW Tekken
        </a>
        <div className="page-links">
          <a
            aria-current={activeSection === "top" ? "page" : undefined}
            href="#top"
          >
            Featured
          </a>
          <a
            aria-current={activeSection === "events" ? "page" : undefined}
            href="#events"
          >
            Events
          </a>
          <a
            aria-current={activeSection === "photos" ? "page" : undefined}
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

      <nav className="section-dots" aria-label="Page sections">
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
        <a
          aria-label="Event photos section"
          aria-current={activeSection === "photos" ? "true" : undefined}
          className={activeSection === "photos" ? "active" : ""}
          href="#photos"
        />
      </nav>

      <section className="hero snap-section" id="top" aria-labelledby="page-title">
        <div className="hero-grid">
          <section className="video-panel" aria-label="KW Tekken VOD playlist">
            <p className="section-label">Featured showcase</p>
            <h2>Tournament footage</h2>
            <div className="video-frame">
              <iframe
                key={youtubeVideoId}
                title="KW Tekken VOD"
                src={youtubeEmbedSrc}
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                allowFullScreen
              />
            </div>
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
            </div>
          </div>
        </div>
      </section>

      <section className="section events-section snap-section" id="events">
        <div className="section-heading">
          <p className="section-label">From start.gg</p>
          <h2>Upcoming events</h2>
          <p>Current brackets and registration live on start.gg.</p>
        </div>

        {shouldShowUpcomingNotice ? (
          <div className="event-feature">
            <div>
              <p className="event-date">More events soon</p>
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
          <div className="event-feature">
            <div>
              <p className="event-date">{formatDate(feed.tournament.startAt)}</p>
              <h3>{feed.tournament.name}</h3>
              <p>
                {feed.tournament.city}
                {feed.tournament.region ? `, ${feed.tournament.region}` : ""}
              </p>
            </div>
            <a
              className="button compact"
              href={feed.sourceUrl || STARTGG_URL}
              {...externalLinkProps()}
            >
              View on start.gg
            </a>
          </div>
        )}

        {sortedEvents.length > 0 && (
          <div className="event-list">
            {sortedEvents.map((event) => (
              <a
                className="event-card"
                href={eventUrl(event)}
                key={event.id}
                {...externalLinkProps()}
              >
                <span className="event-card-date">
                  {formatShortDate(event.startAt)}
                </span>
                <span className="event-card-main">
                  <strong>{event.name}</strong>
                  <small>
                    {event.videogame ? `${event.videogame}` : "Bracket"}
                    {typeof event.numEntrants === "number"
                      ? ` - ${event.numEntrants} entrants`
                      : ""}
                  </small>
                </span>
              </a>
            ))}
          </div>
        )}
      </section>

      <section className="section photos-section snap-section" id="photos">
        <div className="section-heading">
          <p className="section-label">From the venue</p>
          <h2>Event photos</h2>
        </div>

        <div className="photo-carousel" aria-label="Event photo carousel">
          <div
            className="photo-stage"
            onPointerDown={handlePhotoPointerDown}
            onPointerCancel={cancelPhotoPointer}
            onLostPointerCapture={resetPhotoPointerPosition}
            onPointerMove={handlePhotoPointerMove}
            onPointerUp={handlePhotoPointerUp}
            onTouchCancel={cancelPhotoTouch}
            onTouchEnd={handlePhotoTouchEnd}
            onTouchMove={handlePhotoTouchMove}
            onTouchStart={handlePhotoTouchStart}
          >
            {photoPlaceholders.map((gallery, index) => {
              const offset = getPhotoOffset(index);

              return (
              <button
                aria-label={`Show ${gallery.eventName} photo`}
                className={`photo-card photo-card-${offset}`}
                data-photo-index={index}
                key={gallery.src}
                onClick={() => {
                  if (didDragPhoto.current) {
                    didDragPhoto.current = false;
                    return;
                  }

                  setActivePhotoIndex(index);
                }}
                type="button"
              >
                <img
                  alt={`${gallery.eventName} event photo`}
                  className="event-photo"
                  draggable={false}
                  loading="lazy"
                  src={gallery.src}
                />
              </button>
              );
            })}
            <div
              aria-hidden="true"
              className={`swipe-progress ${
                photoSwipe ? `swipe-progress-${photoSwipe.direction}` : ""
              }`}
            >
              <span
                style={{
                  transform: `scaleX(${photoSwipe?.progress ?? 0})`,
                }}
              />
            </div>
          </div>
        </div>
      </section>

    </main>
  );
}

export default App;
