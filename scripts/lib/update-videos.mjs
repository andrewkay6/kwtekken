import { isoNow } from "./clock.mjs";
import { hasMeaningfulChange, readJsonFile, writeJsonAtomic } from "./io.mjs";
import { redactSecrets } from "./secrets.mjs";
import { projectVideos, validateVideos } from "./schema.mjs";
import { VIDEOS_OUT_FILE } from "./paths.mjs";
import {
  DEFAULT_CHANNEL_HANDLE,
  DEFAULT_MAX_RESULTS,
  YouTubeError,
  collectVideoIds,
  fetchChannelIdByHandle,
  fetchChannelPlaylists,
  fetchPlaylistById,
  fetchPlaylistItems,
  selectEventPlaylist,
} from "./youtube.mjs";

function envValue(env, name) {
  const value = env?.[name];

  return typeof value === "string" ? value.trim() : "";
}

function maxResultsFrom(env) {
  const parsed = Number(envValue(env, "YOUTUBE_MAX_RESULTS"));

  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MAX_RESULTS;
}

/**
 * Writes the newest Basement Brawl event playlist into public/videos.json so the
 * homepage embed always points at the current event.
 */
export async function runUpdateVideos(options = {}) {
  const {
    env = process.env,
    fetchImpl = globalThis.fetch,
    now = () => new Date(),
    outFile = VIDEOS_OUT_FILE,
    fs,
    dryRun = false,
    log = () => {},
    warn = () => {},
    error = () => {},
  } = options;

  const ioOptions = fs ? { fs } : {};
  const key = envValue(env, "YOUTUBE_API_KEY");
  const previousFile = await readJsonFile(outFile, ioOptions);
  const previous = previousFile.data;

  if (previousFile.error) {
    warn(`Could not parse ${outFile}; it will be replaced by the next successful YouTube run.`);
  }

  if (!key) {
    warn(`YOUTUBE_API_KEY is not set. Keeping the checked-in ${outFile}.`);

    return {
      status: "skipped",
      exitCode: 0,
      outFile,
      changed: false,
      written: false,
      videoCount: Array.isArray(previous?.videoIds) ? previous.videoIds.length : 0,
      playlistId: previous?.playlistId ?? "",
      playlistTitle: previous?.playlistTitle ?? "",
      videos: previous ?? null,
    };
  }

  const fail = (message) => {
    const safeMessage = redactSecrets(message, env);

    error(`${safeMessage} Keeping the existing file untouched.`);

    return {
      status: "failed",
      exitCode: 1,
      outFile,
      changed: false,
      written: false,
      message: safeMessage,
      videos: null,
      videoCount: 0,
    };
  };

  try {
    const overrideId = envValue(env, "YOUTUBE_PLAYLIST_ID");
    let playlist;
    let source;

    if (overrideId) {
      playlist = await fetchPlaylistById({ fetchImpl, playlistId: overrideId, key });
      source = "env";
    } else {
      const channelId =
        envValue(env, "YOUTUBE_CHANNEL_ID") ||
        (await fetchChannelIdByHandle({
          fetchImpl,
          handle: envValue(env, "YOUTUBE_CHANNEL_HANDLE") || DEFAULT_CHANNEL_HANDLE,
          key,
        }));
      const playlists = await fetchChannelPlaylists({
        fetchImpl,
        channelId,
        key,
        maxResults: maxResultsFrom(env),
      });

      playlist = selectEventPlaylist(playlists);
      source = "discovered";

      if (!playlist) {
        throw new YouTubeError(
          `No "Basement Brawl #N" playlist with items found on channel ${channelId}.`,
          { kind: "empty" },
        );
      }

      log(`Selected YouTube playlist "${playlist.title}" (${playlist.playlistId}).`);
    }

    const items = await fetchPlaylistItems({
      fetchImpl,
      playlistId: playlist.playlistId,
      key,
      maxResults: maxResultsFrom(env),
    });
    const videoIds = collectVideoIds(items);

    if (!videoIds.length) {
      throw new YouTubeError(
        `Playlist "${playlist.title}" (${playlist.playlistId}) has no public, non-deleted videos.`,
        { kind: "empty" },
      );
    }

    const projection = projectVideos({
      generatedAt: isoNow(now),
      playlistId: playlist.playlistId,
      playlistTitle: playlist.title,
      videoIds,
    });
    const videos = projection.value;
    const problems = validateVideos(videos);

    if (problems.length) {
      throw new YouTubeError(`Refusing to write an invalid videos feed: ${problems.join("; ")}`, {
        kind: "schema",
      });
    }

    const changed = hasMeaningfulChange(previous, videos);

    // A refresh that only moved generatedAt must not dirty the working tree.
    if (changed && !dryRun) await writeJsonAtomic(outFile, videos, ioOptions);

    log(
      `${dryRun ? "Would write" : changed ? "Wrote" : "Kept"} ${outFile}: ${videos.videoIds.length} video(s) from "${
        videos.playlistTitle
      }".`,
    );

    return {
      status: "updated",
      exitCode: 0,
      outFile,
      changed,
      written: changed && !dryRun,
      videos,
      videoCount: videos.videoIds.length,
      playlistId: videos.playlistId,
      playlistTitle: videos.playlistTitle,
      playlistSource: source,
    };
  } catch (caught) {
    return fail(caught?.message ?? String(caught));
  }
}
