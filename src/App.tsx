import { useEffect, useMemo, useState } from "react";

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

const DISCORD_URL = "https://discord.gg/mCwGVgjXED";
const TWITCH_URL = "https://twitch.tv/kwtekken";
const YOUTUBE_URL = "https://www.youtube.com/@KWTekken";
const EMAIL_ADDRESS = "kwtekken@gmail.com";
const STARTGG_URL = "https://www.start.gg/tournament/basement-brawl-2-1/details";
const YOUTUBE_PLAYLIST_ID = "PLDyBGN2GWY8E";
const LAST_YOUTUBE_VIDEO_KEY = "kwtekken:lastYoutubeVideoId";
const YOUTUBE_PLAYLIST_VIDEO_IDS = [
  "92q7NO9bBjU",
  "SBdU5mc9s7Y",
  "4POWB4aa4HM",
  "KHaLOsv6t94",
  "lOE2px750z8",
  "d2QRABA2bO8",
  "oRGf-MW_aX4",
  "btFSvlUmsLc",
  "bVSTvYKKoC4",
  "yAEzZ2tmpj4",
  "Zd1K6Lir7Co",
  "PaucqtO2oaQ",
];

const fallbackFeed: EventFeed = {
  sourceUrl: STARTGG_URL,
  generatedAt: null,
  tournament: {
    name: "Basement Brawl 2",
    slug: "tournament/basement-brawl-2-1",
    startAt: 1783526400,
    endAt: null,
    venueAddress: "",
    city: "Kitchener-Waterloo",
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

function eventUrl(event: SceneEvent) {
  if (!event.slug) return STARTGG_URL;
  return `https://www.start.gg/${event.slug}`;
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

function App() {
  const [feed, setFeed] = useState<EventFeed>(fallbackFeed);
  const [youtubeVideoId] = useState(selectRandomYoutubeVideoId);

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

  const sortedEvents = useMemo(
    () =>
      [...feed.events].sort((a, b) => {
        if (!a.startAt && !b.startAt) return a.name.localeCompare(b.name);
        if (!a.startAt) return 1;
        if (!b.startAt) return -1;
        return a.startAt - b.startAt;
      }),
    [feed.events],
  );

  const youtubeEmbedSrc = `https://www.youtube-nocookie.com/embed/${youtubeVideoId}?list=${YOUTUBE_PLAYLIST_ID}&rel=0`;

  return (
    <main>
      <section className="hero" aria-labelledby="page-title">
        <nav className="topbar" aria-label="Primary">
          <a className="wordmark" href="#top" aria-label="KW Tekken home">
            KW Tekken
          </a>
          <div className="quick-links">
            <a href={TWITCH_URL}>Twitch</a>
            <a href={YOUTUBE_URL}>YouTube</a>
            <a href={`mailto:${EMAIL_ADDRESS}`}>Email</a>
          </div>
        </nav>

        <div className="hero-grid" id="top">
          <section className="video-panel" aria-label="KW Tekken VOD playlist">
            <p className="video-kicker">Recent tournament footage</p>
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
              <a className="button primary" href={TWITCH_URL}>
                Watch live on Twitch
              </a>
              <a className="button secondary" href={YOUTUBE_URL}>
                YouTube channel
              </a>
            </div>
          </section>

          <div className="hero-copy">
            <p className="eyebrow">Kitchener-Waterloo fighting game locals</p>
            <h1 id="page-title">Play Tekken in KW.</h1>
            <p className="lede">
              Find brackets, casuals, weekly VODs, and the people keeping the
              local scene moving.
            </p>
            <div className="hero-actions" aria-label="Community links">
              <a className="button primary" href={DISCORD_URL}>
                Join Discord
              </a>
              <a className="button secondary" href="#events">
                See events
              </a>
            </div>
          </div>
        </div>
      </section>

      <section className="section events-section" id="events">
        <div className="section-heading">
          <p className="eyebrow">From start.gg</p>
          <h2>Upcoming events</h2>
          <p>Current brackets and registration live on start.gg.</p>
        </div>

        <div className="event-feature">
          <div>
            <p className="event-date">{formatDate(feed.tournament.startAt)}</p>
            <h3>{feed.tournament.name}</h3>
            <p>
              {feed.tournament.city}
              {feed.tournament.region ? `, ${feed.tournament.region}` : ""}
            </p>
          </div>
          <a className="button compact" href={feed.sourceUrl || STARTGG_URL}>
            View on start.gg
          </a>
        </div>

        {sortedEvents.length > 0 && (
          <div className="event-list">
            {sortedEvents.map((event) => (
              <a className="event-card" href={eventUrl(event)} key={event.id}>
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

    </main>
  );
}

export default App;
