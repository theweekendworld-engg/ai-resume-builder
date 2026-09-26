/**
 * Every LinkedIn DOM selector "Send to Patronus" depends on, in one place.
 *
 * LinkedIn renames classes without notice, so each list runs from most
 * specific to most generic, and `scoutExtract.ts` falls back to a text-density
 * scan when none match. When extraction breaks after a LinkedIn deploy, this
 * file is where the fix goes, and the fixture test in
 * `__tests__/parsers/scoutExtract.test.ts` is what proves it.
 *
 * Prefer structural hooks (`data-urn`, `data-id`, ARIA) over class names:
 * they carry meaning LinkedIn's own code depends on, so they churn less.
 */

/** One post (feed item or permalink page). */
export const POST_CONTAINER_SELECTORS = [
    '[data-urn^="urn:li:activity:"]',
    '[data-id^="urn:li:activity:"]',
    '[data-urn^="urn:li:share:"]',
    '[data-urn^="urn:li:ugcPost:"]',
    'div.feed-shared-update-v2',
    'article.main-feed-activity-card',
    'div.occludable-update',
] as const;

/** The post body inside a container. */
export const POST_TEXT_SELECTORS = [
    '.update-components-text',
    '.feed-shared-inline-show-more-text',
    '.feed-shared-update-v2__description',
    '.feed-shared-text',
    '[data-test-id="main-feed-activity-card__commentary"]',
    '.attributed-text-segment-list__content',
] as const;

/** The post author's display name. */
export const POST_AUTHOR_SELECTORS = [
    '.update-components-actor__title span[aria-hidden="true"]',
    '.update-components-actor__name span[aria-hidden="true"]',
    '.update-components-actor__name',
    '.feed-shared-actor__name',
    '[data-test-id="main-feed-activity-card__entity-lockup"] a',
] as const;

/** A link to the author's profile or company page. */
export const POST_AUTHOR_LINK_SELECTORS = [
    'a.update-components-actor__meta-link',
    'a.update-components-actor__image',
    'a.feed-shared-actor__container-link',
    'a[href*="/in/"]',
    'a[href*="/company/"]',
] as const;

/** Long-form articles (`/pulse/…`). */
export const ARTICLE_BODY_SELECTORS = [
    '.reader-article-content',
    'article .article-content',
    '[data-test-id="article-content-blocks"]',
    'article',
] as const;

export const ARTICLE_TITLE_SELECTORS = ['h1.reader-article-header__title', 'article h1', 'h1'] as const;

/**
 * Chrome UI that must never be mistaken for content by the density fallback:
 * navigation, the messaging overlay, sidebars, comment threads.
 */
export const NOISE_SELECTORS = [
    'nav',
    'header',
    'footer',
    'aside',
    '[role="navigation"]',
    '[role="banner"]',
    '#msg-overlay',
    '.msg-overlay-container',
    '.comments-comments-list',
    '.social-details-social-counts',
    '.feed-shared-social-action-bar',
] as const;

/** URN attributes that carry the post identity. */
export const POST_URN_ATTRIBUTES = ['data-urn', 'data-id'] as const;
