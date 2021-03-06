import { HarkeParsingError, parse } from '../parse';
import {
  ParsedPlaylistPage,
  ParserFieldParams,
  PlaylistVideo,
  PlaylistVideoUnavailable,
} from '../types';
import { convertHHMMSSDurationToMs, extractNumberFromString } from '../utils';

function parsePlaylistPage(html: string): ParsedPlaylistPage {
  const schema = {
    id({ $ }: ParserFieldParams): string {
      // extract GET param via meta tag
      const url = $('meta[property="og:url"]').attr('content');
      const params = new URLSearchParams(url?.split('?')[1]);
      const id = params.get('list');

      if (!id) throw new HarkeParsingError();

      return id;
    },

    title({ $ }: ParserFieldParams): string {
      const title = $('h1#title').text();
      if (!title) throw new HarkeParsingError();

      return title.trim();
    },

    description({ $ }: ParserFieldParams): string {
      const description = $('div#description').text() || '';
      return description.trim() || '';
    },

    viewCount({ $ }: ParserFieldParams): number {
      const viewCount = $(
        'div#stats > .style-scope.ytd-playlist-sidebar-primary-info-renderer:nth-child(2)',
      ).text();
      const viewCountNumber = extractNumberFromString(viewCount);

      // View count may not be a number if the playlist has no views.
      // For EN, it is `no views` and `viewCountNumber` is null.

      return viewCountNumber || 0;
    },

    videoCount({ $ }: ParserFieldParams): number {
      const videoCount = $(
        'div#stats > .style-scope.ytd-playlist-sidebar-primary-info-renderer:nth-child(1)',
      ).text();
      const videoCountNumber = extractNumberFromString(videoCount);
      return videoCountNumber || 0;
    },

    updatedAtString({ $ }: ParserFieldParams): string {
      const updatedAt = $(
        'div#stats > .style-scope.ytd-playlist-sidebar-primary-info-renderer:nth-child(3)',
      ).text();
      if (!updatedAt) throw new HarkeParsingError();

      return updatedAt;
    },

    videos({
      $,
    }: ParserFieldParams): (PlaylistVideo | PlaylistVideoUnavailable)[] {
      const result: (PlaylistVideo | PlaylistVideoUnavailable)[] = [];

      $('#contents > .ytd-playlist-video-list-renderer').each(
        (_idx, el: cheerio.Element) => {
          const $el = $(el);
          const href = $el.find('a#thumbnail').attr('href');
          if (href == null) return;

          const params = new URLSearchParams(href.replace('/watch?', ''));
          const id = params.get('v');

          let title = $el.find('#video-title').text();
          const duration = convertHHMMSSDurationToMs(
            $el
              .find('.ytd-thumbnail-overlay-time-status-renderer:not([hidden])')
              .text(),
          );
          let channelName = $el.find('.ytd-channel-name a').text();
          const channelUrl = $el.find('.ytd-channel-name a').attr('href');
          const thumbnailUrl = $el.find('a#thumbnail img').attr('src');

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
          if (!id || !title || !duration || !channelName || !channelUrl) {
            return;
          } else {
            result.push({
              id,
              title,
              duration,
              channelName,
              channelUrl,
            });
          }
        },
      );

      // a playlist can be empty

      return result;
    },
  };

  return parse('playlist-page', html, schema);
}

export { parsePlaylistPage };
