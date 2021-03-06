import { parse } from '../parse';
import {
  ParsedWatchHistory,
  ParserFieldParams,
  WatchlistVideo,
  WatchlistVideoUnavailable,
} from '../types';
import {
  convertHHMMSSDurationToMs,
  convertPercentageStringToNumber,
} from '../utils';

function parseWatchHistory(html: string): ParsedWatchHistory {
  const schema = {
    videos({
      $,
    }: ParserFieldParams): (WatchlistVideo | WatchlistVideoUnavailable)[] {
      const result: (WatchlistVideo | WatchlistVideoUnavailable)[] = [];

      // parsing date-video chunks
      $('#contents .ytd-section-list-renderer').each(
        (_idx, chunkEl: cheerio.Element) => {
          const $chunkEl = $(chunkEl);
          const watchedAt = $chunkEl.find('#title').text();

          $chunkEl
            .find('ytd-video-renderer')
            .each((_idx, el: cheerio.Element) => {
              const $el = $(el);
              const href = $el.find('a#thumbnail').attr('href');
              if (href == null) return;

              const params = new URLSearchParams(href.replace('/watch?', ''));
              const id = params.get('v');
              let title = $el.find('#video-title').text();
              const description = $el.find('#description-text').text() || '';
              const duration = convertHHMMSSDurationToMs(
                $el
                  .find(
                    '.ytd-thumbnail-overlay-time-status-renderer:not([hidden])',
                  )
                  .text(),
              );
              let channelName = $el.find('.ytd-channel-name a').text();
              const channelUrl = $el.find('.ytd-channel-name a').attr('href');
              const thumbnailUrl = $el.find('a#thumbnail img').attr('src');
              const percWatchedValue = $el
                .find(
                  '.ytd-thumbnail .ytd-thumbnail-overlay-resume-playback-renderer',
                )
                .css('width');
              const percWatched = percWatchedValue
                ? convertPercentageStringToNumber(percWatchedValue)
                : 0;

              // trim strings
              title = title && title.trim();
              channelName = channelName && channelName.trim();

              // push video
              // check if video is deletec and has default thumbnail
              if (
                id &&
                !duration &&
                !channelName &&
                !channelUrl &&
                title.startsWith('[') &&
                thumbnailUrl === 'https://i.ytimg.com/img/no_thumbnail.jpg'
              ) {
                result.push({ id, unavailable: true });
              }
              if (
                !id ||
                !title ||
                !duration ||
                !channelName ||
                !channelUrl ||
                !percWatched
              ) {
                return;
              } else {
                result.push({
                  id,
                  title,
                  description,
                  duration,
                  channelName,
                  channelUrl,
                  watchedAt,
                  percWatched,
                });
              }
            });
        },
      );

      // watch history can be empty

      return result;
    },
  };

  return parse('user-watch-history', html, schema);
}

const watchHistoryUrl = 'https://www.youtube.com/feed/history';

export { watchHistoryUrl, parseWatchHistory };
