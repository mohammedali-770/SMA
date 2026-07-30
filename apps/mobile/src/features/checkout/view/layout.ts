/**
 * Shared layout constant for the checkout column.
 *
 * Lives in its own module rather than on the screen so the sticky footer can
 * read it without importing the screen that renders the footer — a cycle that
 * Metro tolerates but that makes the dependency direction a lie.
 */

/**
 * Widest the checkout column ever gets. Checkout is one column of decisions;
 * on a tablet, letting it run the full width turns a 40-character line into a
 * 120-character one and drags the money column metres from its labels. Below
 * this cap — every phone — it changes nothing.
 */
export const CONTENT_MAX_WIDTH = 640;
