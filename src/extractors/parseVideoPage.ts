import { HarkeParsingError, parse } from '../parse';
import {
  Channel,
  ParsedVideoPage,
  ParserFieldParams,
  RecommendedVideo,
} from '../types';
import {
  convertHHMMSSDurationToMs,
  convertISO8601ToMs,
  convertPercentageStringToNumber,
  extractNumberFromString,
} from '../utils';

function parseVideoPage(html: string): ParsedVideoPage {
  const getSentiment = ($: cheerio.Root) => {
    // check if there is no like bar
    const likeBarEl = $('#like-bar');
    if (likeBarEl == null) return null;

    // `likeBarEl.attr('style')` is undefined if no inline style was set
    if (likeBarEl.attr('style') == null) return null;
    return $('#sentiment #tooltip').first().text().split(' / ');
  };

  const schema = {
    id({ $ }: ParserFieldParams): string {
      const urlValue = $('link[rel=canonical]').attr('href');
      if (!urlValue) throw new HarkeParsingError();

      const params = new URLSearchParams(
        urlValue.replace('https://www.youtube.com/watch', ''),
      );
      const videoId = params.get('v');

      if (!videoId) throw new HarkeParsingError('invalid video id');

      return videoId;
    },

    title({ linkedData }: ParserFieldParams): string {
      if (!linkedData) throw new HarkeParsingError('invalid title');

      try {
        return linkedData.name;
      } catch {
        throw new HarkeParsingError('invalid title');
      }
    },

    description({ linkedData }: ParserFieldParams): string {
      if (!linkedData) throw new HarkeParsingError('invalid description');

      return linkedData.description ?? '';
    },

    duration({ linkedData }: ParserFieldParams): number {
      if (!linkedData) throw new HarkeParsingError('invalid duration');

      const value = convertISO8601ToMs(linkedData.duration);
      if (value === 0) throw new HarkeParsingError('invalid duration');

      return value;
    },

    channel({ $ }: ParserFieldParams): Channel {
      const channelLinkEl = $('#upload-info a[href^="/channel/"]').first();
      const channelImgEl = $('#meta #img').first();

      return {
        id: (() => {
          const channelUrl = channelLinkEl.attr('href');
          if (!channelUrl) throw new HarkeParsingError('invalid channel');
          const channelUrlChunks = channelUrl.split('/');

          return channelUrlChunks[channelUrlChunks.length - 1];
        })(),
        name: channelLinkEl.text() ?? '',
        url: channelLinkEl.attr('href') ?? '',
        thumbnail: channelImgEl.attr('src') ?? '',
      };
    },

    uploadDate({ linkedData }: ParserFieldParams): Date {
      if (!linkedData) throw new HarkeParsingError('invalid upload date');

      try {
        const uploadDateValue = linkedData.uploadDate;
        const dateParts = uploadDateValue
          .split('-')
          .map((s: string) => Number(s));
        return new Date(dateParts[0], dateParts[1] - 1, dateParts[2]);
      } catch {
        throw new HarkeParsingError(JSON.stringify(linkedData));
      }
    },

    viewCount({ linkedData }: ParserFieldParams): number {
      if (!linkedData) throw new HarkeParsingError();

      const number = Number(linkedData.interactionCount);
      return number;
    },

    upvotes({ $ }: ParserFieldParams): number | null {
      const sentiment = getSentiment($);
      if (sentiment === null) return null;

      const upvotesStr = sentiment[0];
      if (upvotesStr === null) throw new HarkeParsingError();

      const number = extractNumberFromString(upvotesStr);
      if (number === null) throw new HarkeParsingError();
      return number;
    },

    downvotes({ $ }: ParserFieldParams): number | null {
      const sentiment = getSentiment($);
      if (sentiment === null) return null;

      const upvotesStr = sentiment[1];
      if (upvotesStr === null) throw new HarkeParsingError();

      const number = extractNumberFromString(upvotesStr);
      if (number === null) throw new HarkeParsingError();
      return number;
    },

    category({ linkedData }: ParserFieldParams): string {
      if (!linkedData) throw new HarkeParsingError();

      try {
        return linkedData.genre;
      } catch {
        throw new HarkeParsingError();
      }
    },

    isLive({ linkedData }: ParserFieldParams): boolean {
      if (!linkedData) throw new HarkeParsingError();

      if (!('publication' in linkedData)) return false;

      // not sure in what situations the array may contain multiple objects
      for (const p of linkedData.publication) {
        if ('isLiveBroadcast' in p)
          return p.isLiveBroadcast && !('endDate' in p);
      }
      throw new HarkeParsingError();
    },

    wasLive({ linkedData }: ParserFieldParams): boolean {
      if (!linkedData) throw new HarkeParsingError();

      if (!('publication' in linkedData)) return false;

      // not sure in what situations the array may contain multiple objects
      for (const p of linkedData.publication) {
        if ('isLiveBroadcast' in p) return p.isLiveBroadcast && 'endDate' in p;
      }
      throw new HarkeParsingError();
    },

    hashtags({ $ }: ParserFieldParams): string[] {
      const result: string[] = [];

      $('a[href^="/hashtag/"]').each((_idx, el: cheerio.Element) => {
        const parentEl = el as cheerio.TagElement;
        const childNode = parentEl.firstChild;

        if (
          !childNode ||
          childNode.type !== 'text' ||
          !childNode.data ||
          result.includes(childNode.data)
        )
          return;

        result.push(childNode.data);
      });

      return result;
    },

    clarifyBox({ $ }: ParserFieldParams): string {
      return $('#clarify-box').text().trim();
    },

    recommendedVideosTags({ $ }: ParserFieldParams): string[] {
      const result: string[] = [];

      $('#chips #text').each((_idx, el) => result.push($(el).text()));

      return result;
    },

    recommendedVideos({ $ }: ParserFieldParams): RecommendedVideo[] {
      const result: RecommendedVideo[] = [];

      $('#related ytd-compact-video-renderer').each(
        (_idx: number, el: cheerio.Element) => {
          const $el = $(el);
          const videoUrl = $el.find('.metadata > a').attr('href');

          if (videoUrl == null) return;

          const params = new URLSearchParams(videoUrl.replace('/watch?', ''));
          const id = params.get('v');

          if (id == null) return;

          const title = $el.find('.metadata #video-title').text().trim();

          // `duration` gets lazyloaded but we should still try to get the data.
          let duration = -1;
          try {
            duration = convertHHMMSSDurationToMs(
              $el.find('.ytd-thumbnail-overlay-time-status-renderer').text(),
            );
            // eslint-disable-next-line no-empty
          } catch (e) {}

          const channelName = $el
            .find('.metadata .ytd-channel-name #text')
            .text();
          const percWatchedValue = $el
            .find(
              '.ytd-thumbnail .ytd-thumbnail-overlay-resume-playback-renderer',
            )
            .css('width');
          const percWatched = percWatchedValue
            ? convertPercentageStringToNumber(percWatchedValue)
            : 0;

          const uploadedAtString = $el
            .find(
              '#metadata-line span.style-scope.ytd-video-meta-block:nth-child(2)',
            )
            .text()
            .trim();

          result.push({
            id,
            title,
            duration,
            channelName,
            percWatched,
            uploadedAtString,
          });
        },
      );

      // Allow the recommended videos to be empty since it occasionally happen that
      // there are no recommended videos.
      // if (!result.length) throw new HarkeParsingError(JSON.stringify(result));

      return result;
    },
  };

  const result = parse('video-page', html, schema);

  // some fields do not apply to live videos
  if (result.fields.isLive) {
    const filtered = result.errors.filter(
      (x) => !['duration'].includes(x.field),
    );
    result.errors = filtered;
  }
  return result;
}

export { parseVideoPage };
