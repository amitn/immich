# PR screenshots: AI assistant, photo books, artistic styles, auto-enhance, tags

Captured from the local dev instance at 1440×900, logged in as the demo user. The admin account was used only for the settings pages. Hero shots have `-dark` and `-light` variants. `contact-sheet.jpg` shows them all at a glance.

- `01-assistant-streaming-{dark,light}.png`: The assistant working live on "Make an album called 'Sicily 2009 highlights'…", with tool-call cards streaming in. Each card has a thumbnail strip (Find events, Select best photos, View photos, Score photos).
- `02-assistant-permission-{dark,light}.png`: An "Improve photos" permission card (3 photos) waiting for Allow / Allow all in this chat / Deny. Auto-approve is off.
- `02b-assistant-permission-summary-dark.png` (crop): The "Create album" permission card with its readable summary ("Name: … · Description: … · 20 photos") and the photos.
- `03-assistant-reply-{dark,light}.png`: The finished reply, listing every stop, the near-duplicate handling and the fixes (originals kept, copies stacked).
- `03b-assistant-open-album-link-dark.png` (crop): The completed Create album tool card with its "Open album" link.
- `04-album-sicily-2009-highlights-{dark,light}.png`: The album the assistant created (20 photos).
- `05-album-menu-export-as-book-dark.png` (crop): The album "…" menu with the new "Export as book…" item.
- `06-export-as-book-dialog-dark.png`: The "Export album as a photo book" dialog: title, page sizes (two-line labels), style swatches, and pages set to "Auto".
- `06a-export-as-book-dialog-options-dark.png`: The same dialog scrolled down: map options, and "Improve photos" as a switch.
- `06b-export-progress-notes-dark.png`: The export progress dialog, with "Notes about the layout" (the watercolor map falls back to the sketch without a Stadia key) and the PDF ready.
- `07-book-viewer-cover-dark.png`: The book viewer on the cover (serif title for the Soft style), with the page strip.
- `08-book-spread-{dark,light}.png`: Spread mode, pages 4–5, with place captions ("Taormina", "Taormina & Catania").
- `09-book-map-page-dark.png`: Map page: an offline sketch with coast and land, teardrop pins, paper texture and a route from Milo/Mazzeo/Taormina to Avola.
- `10-book-review-panel-dark.png`: The Book review panel docked beside the page ("Map style not available", "Repeated layout", weakest photos).
- `11-book-edit-pages-dark.png`: Edit pages mode, with the slot overlay on page 4 and photo 1 selected.
- `12-book-edit-pages-photo-actions-dark.png`: Edit pages: section title, page caption and the selected photo's actions (Replace, Adjust crop, Reset crop, Remove), plus the page strip.
- `13-book-style-menu-dark.png`: The dark-themed Style menu (Soft / Classic / Bold).
- `14-book-preview-{dark,light}.png`: The Preview modal: the page-turning HTML book on the pages 4–5 spread.
- `15-photo-books-list-sidebar-dark.png`: The Photo books list page, with the Photo books sidebar item expanded.
- `16-asset-viewer-menu-dark.png`: The asset viewer "…" menu with Ask assistant, Artistic style… and Auto enhance.
- `17-artistic-style-modal-dark.png`: The "Artistic style" modal with the style grid.
- `18-artwork-in-viewer-dark.png`: The new "Editorial watercolor split" artwork in the viewer, stacked with its original. The top half is the untouched photo.
- `19-artwork-side-by-side.png`: The original photo next to the watercolor split (caption "a quiet afternoon").
- `20-auto-enhance-modal-dark.png`: The Auto enhance modal: strength, before/after, and the list of adjustments with reasons.
- `21-explore-tags-row-dark.png`: Explore with the new Tags row (AI Artwork, its styles, and Edits/Improved).
- `22-tags-sidebar-expanded-dark.png`: The Tags sidebar tree expanded (AI Artwork › styles, Edits › Improved).
- `23-search-ai-artwork-tag-dark.png`: Search results filtered by the "AI Artwork" tag.
- `24-admin-ai-assistant-dark.png`: Admin › Settings › AI Assistant: privacy note, enable toggle, chat profile, art profile.
- `25-admin-ai-assistant-approval-dark.png`: Admin › AI Assistant: idle timeout, auto-approve changes, MCP URL.
- `26-admin-agent-profiles-dark.png`: Admin › AI Assistant › Agent profiles (the local command path is blurred).
- `27-admin-photo-books-dark.png`: Admin › Settings › Photo books (map tiles and privacy, Stadia key, default map style).

## Collections, themed books, sharing, styles and highlight videos (28–63)

- `28-collections-museum-visits-dark.png`: "Name the artworks" (album "…" menu): the 3 museum visits found, with their artwork, label and named counts.
- `29-collections-museum-artworks-{dark,light}.png`: The Museu de Évora visit: each artwork matched with its parsed wall-label caption ("Virgin and Child — Nicolau Chanterene, 1535-1540, marble").
- `30-collections-museum-wall-labels-dark.png`: The same visit: the museum name from the tags and the 15 wall-label photos read.
- `31-collections-wine-thanksgiving-dark.png`: "Name the wines" on the Thanksgiving tasting 2013: the bottles named producer · wine · vintage.
- `32-collections-cookbook-quiche-dark.png`: "Name the recipe steps" on the Quiche: the recipe card and "4 steps read on the recipe".
- `33-collections-cookbook-quiche-steps-dark.png`: The Quiche cooking photos, each matched to its recipe step.
- `34-collections-travel-crete-dark.png`: "Name the legs of a trip" on Crete, October 2016: the travel documents, the OCR warnings and the legs.
- `35-book-gallery-spread-{dark,light}.png`: A Gallery (museum) book spread: every artwork shown whole, with a museum-label caption and a catalogue number.
- `36-book-gallery-spread-sculpture-dark.png`: A Gallery spread of the Kolkata sculptures.
- `37-book-cellar-notes-tasting-note-dark.png`: A Cellar notes tasting-note page: producer in small caps, wine, vintage and ruled lines for the note.
- `38-book-cookbook-recipe-dark.png`: A Cookbook recipe page: the Quiche card photo, the title, the times and the typeset ingredients.
- `39-book-travel-ticket-stub-bus-dark.png`: A Travel ticket-stub page (bus Chania → Soutia): no passenger name or booking code.
- `40-book-travel-ticket-stub-ferry-dark.png`: A Travel ticket-stub page (ferry Sougia → Sfakia), with the "also written on the ticket" note.
- `41-photo-books-list-themes-dark.png`: The Photo books list with the themed books.
- `42-assistant-ask-your-library-dark.png`: The Assistant empty state with the "Ask your library" suggestions.
- `43-assistant-answer-museums-{dark,light}.png`: A live answer to "Which museums did we visit?": a table of the 3 visits from the collections.
- `44-assistant-answer-french-laundry-{dark,light}.png`: A live answer to "What did we eat at The French Laundry?": the 12 named courses, with a thumbnail strip.
- `45-assistant-chat-list-delete-dark.png`: The chat list with its per-chat delete buttons (selected and hovered rows) and "Delete all chats".
- `46-book-share-modal-dark.png`: Sharing a photo book: the book link description and "Allow downloading the PDF".
- `47-shared-links-photo-books-tab-dark.png` (crop): Sharing → Shared links, on the new Photo books tab.
- `48-public-shared-book-{dark,light}.png`: The public shared-book page, logged out, as a page-turning web book.
- `49-style-create-with-assistant-dark.png`: The "Create a book style" modal (Style menu → Create with assistant…), with example prompts.
- `50-style-menu-your-styles-dark.png`: The Style menu with the themed presets, "Your styles" (Wedding: ivory, sage and gold) and Create with assistant…
- `51-manage-styles-modal-dark.png`: The Manage styles modal (Photo books page).
- `52-book-applying-style-dark.png`: The "Applying the Wedding: ivory, sage and gold style…" status line while the pages re-render.
- `53-book-wedding-style-applied-dark.png`: The book after the Wedding style was applied.
- `54-artistic-style-create-with-assistant-dark.png`: The Artistic style modal with its Custom style and "Create with assistant…".
- `55-highlight-video-modal-dark.png`: The "Make a highlight video" modal: title, length, style, maps, captions and music.
- `56-highlight-video-progress-dark.png`: The rendering progress card ("Rendering… 54%") on the album.
- `57-highlight-video-frame-{dark,light}.png`: A frame of the finished 30 s museum highlight video in the viewer, with a museum-label lower third.
- `58-highlight-video-frame-caption-dark.png`: Another frame of the video (a portrait with its label).
- `59-book-review-checked-at-dark.png`: The Book review panel after "Check again", showing "Checked at …" and docked beside the page.
- `60-user-settings-suggested-books-dark.png`: User settings → Features → Suggested books.
- `61-admin-food-openstreetmap-dark.png`: Admin → Settings → Food: the OpenStreetMap restaurant lookup and the Overpass URL.
- `62-admin-photo-books-drafts-dark.png`: Admin → Settings → Photo books: map tiles and the Suggested books toggles.
- `63-admin-photo-books-drafts-limits-dark.png`: Admin → Photo books: the draft kinds and "Books per night".

Demo photos by gnuckx, CC BY 2.0, via Wikimedia Commons (see ATTRIBUTION.md)
