# AI Assistant (experimental)

The AI assistant lets you ask for things in plain language, such as _"Make an album of our summer holiday in Italy, about 150 photos, make sure both girls are in it, and crop the portraits to square"_ or _"Make a 20-page photo book of our Italy trip"_. It can also turn photos into artwork, such as a watercolor travel-journal page.

Gallery doesn't include an AI model itself. It connects to an AI agent you already use, such as [Claude Code](https://www.anthropic.com/claude-code), [Codex](https://openai.com/codex), Gemini CLI or OpenCode, through the [Agent Client Protocol (ACP)](https://agentclientprotocol.com). The agent plans the work, and Gallery gives it a set of photo tools over [MCP](https://modelcontextprotocol.io).

Some related features don't use AI at all: [auto-enhance and straightening](#auto-enhance-and-straighten) run locally on your server, photo books can be laid out, edited and exported without the assistant, and [naming the dishes](#food) of your meals uses the smart search and OCR models of your server.

:::caution Experimental
This feature is experimental and disabled by default. The agent runs as a process inside the Gallery server container. When it uses a cloud model, the photos it looks at (previews, contact sheets and rendered book pages), their metadata and the names of people are sent to that provider.
:::

## The assistant

### What it can do

With its tools, the assistant can:

- understand your library: search by meaning and filters, find people, split a date range or album into events and trips, read metadata, and look at photos on a contact sheet;
- choose photos: group bursts and near-duplicates, score sharpness, exposure and faces, and pick a balanced selection (for example _"the 30 best photos of last year, no more than 2 per event"_);
- crop photos around faces, straighten tilted photos, enhance dull ones and [turn sideways ones upright](#sideways-and-upside-down-photos);
- create albums, and add or remove photos;
- design, review, edit and export [photo books](#photo-books);
- make [highlight videos](#highlight-videos) of albums, books and selections;
- make [collages](#collages) of a few photos;
- create [artistic versions](#artistic-styles) of photos;
- [design book and artistic styles of your own](#designing-your-own-styles) from a description;
- find the restaurant meals among your photos, read their menus and [name the dishes](#food);
- [answer questions about your library](#asking-about-your-library), such as _"when did we last make the quiche?"_, from the dishes, recipes, artworks and trips it named;
- list and use your tags.

### Where to find it

- The **Assistant** page in the sidebar. It lists your **Chats**; start one with **New chat**. Deleting a chat keeps the albums, photos and books the assistant created.
- **Albums → Create with assistant** opens a new chat with a ready-to-send request for an album of your best photos, in which the assistant asks which dates, places or people you'd like. The **Photo books** page has a **Create with assistant** button that does the same for a photo book.
- **Ask assistant**: select photos in the timeline, or open a photo and use the menu. The photos are attached to your next message.

While it works, the chat shows the assistant's plan and each tool it calls. Results link to the albums, photos and books it made (**Open album**, **Open photo book**).

### Approvals

The assistant can search and look at your photos freely. Actions that change your library ask first, with a **Permission needed** card in the chat:

- **Allow** runs this one action.
- **Allow all in this chat** runs it and turns on auto-approve for the rest of the chat.
- **Deny** refuses it. The assistant is told not to retry and asks you what to do instead.

Actions that ask for approval include creating an album, adding or removing photos, cropping, straightening, enhancing, improving or turning photos, saving a collage, creating artwork, illustrating maps, exporting or sharing a book, and editing a book that wasn't created in the current chat. Books the assistant creates in the chat are drafts, so it edits them without asking. An unanswered request counts as declined after 10 minutes.

To skip the prompts, turn on **Auto-approve** at the top of a chat. It only applies to that chat. An administrator can also turn on **Auto-approve changes** in the settings, which skips approvals for every user.

### Stopping a run

Select **Stop** next to the message box to cancel the current run. Any pending approval is denied. You can send a new message afterwards.

### Undoing the assistant's changes

Every change the assistant makes is recorded in the **activity log**, with what's needed to undo it. So are the changes you make with the assistant's features in the web app: naming the photos of a visit (**Name the dishes** and the other collection dialogs), keeping or discarding a suggested book, saving a book or art style, changing the style of a book, sharing a book with a link, and making a highlight video.

You can undo from three places:

- **In the chat.** A completed tool call that changed your library has an **Undo** button. Each turn that changed something ends with **Undo this turn**, which undoes all the changes of that reply, newest first.
- **The Activity panel.** Select **Changes** at the top of the Assistant page to list the changes of the chat (**This chat**) or all of them (**All**).
- **The Activity log page.** Open it from the user menu (your avatar, then **Activity log**). Filter by who made the change (the assistant or you), the kind of change, whether it was undone, and the dates.

You can also ask the assistant, for example "undo what you just did" or "put the photos back in the album". It looks up its changes with `list_activity` and undoes them with `undo_activity`, which asks for your approval like any other change.

What undo does:

| Change                                                                             | Undo                                                                                                                                                                     |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Photos added to or removed from an album                                           | Removes or puts back exactly those photos.                                                                                                                               |
| A new album                                                                        | Deletes the album, but only if it's unchanged since it was created: same name, description and photos, and not shared. Albums have no trash, so a changed album is kept. |
| A copy (crop, straighten, enhance, improve), an artwork or a style test, a collage | Moves the copy to the trash and takes it out of its stack, as the stack was before. You can restore it from the trash.                                                   |
| Names of a collection (tags and descriptions)                                      | Gives the photos back the tags of the pack and the descriptions they had.                                                                                                |
| A book edit (layout, photos, captions, maps, style, improved photos)               | Restores the book from a copy taken before the change. Improved copies the change placed in the book go to the trash.                                                    |
| A new book                                                                         | Deletes the book, but only if it's unchanged since it was made and not shared.                                                                                           |
| Keeping or discarding a suggested book                                             | Makes it a suggestion again. A discarded book is laid out again from its copy.                                                                                           |
| A saved book or art style                                                          | Deletes the style, unless it was edited since. Books keep their copy of the style.                                                                                       |
| A book link                                                                        | Deletes the link.                                                                                                                                                        |
| A highlight video                                                                  | Stops it if it's still rendering; otherwise takes the video out of its album and moves it to the trash.                                                                  |

Undo never deletes photos or videos for good: new ones go to the trash.

**Safety checks.** A change that later changes depend on is refused, with the reason and what to do instead:

- a copy that was placed in a book since (remove it from the book, or undo that change first);
- a book that was edited again after the change (undo the later edits first; **Undo this turn** does this in the right order);
- an album that changed since it was created;
- photos that were named again since (they keep their new names, and the others are restored);
- an artwork that is still being made.

When part of a change can't be undone, for example a photo that was deleted since, the rest is undone and the result says what was left as it was.

**Redo.** A toast after undoing offers **Redo** for the changes that are simple to repeat: adding photos to an album, removing them, and keeping a suggested book. Other changes can't be redone; ask the assistant to do them again.

**Notifications.** When an auto-approved reply makes several changes, you get a notification, "The assistant made 12 changes", which opens those changes in the activity log.

**Retention.** Changes are kept for 90 days by default (`agent.activityRetentionDays`), and removed with the nightly database cleanup. A change can be undone as long as it's in the log and its safety checks pass. For each book, the copies of the last 50 versions are kept; an older book edit can't be undone. Only you can undo your changes.

### Asking about your library

Ask the assistant about your own life, and it answers in the chat from the names your collections hold: the dishes of your [restaurant meals](#food), your [recipes](#cookbook), the artworks of your [museum visits](#museum--gallery-visits), the legs of your [trips](#travel-documents), the acts of your [gigs](#concerts) and the species of your [garden walks](#nature-field-guide), with the dates, places (the city and country of the photos) and people of their photos. For example:

- _"What did I eat at The French Laundry?"_
- _"When did we last make the quiche?"_
- _"Which museums did we visit in 2025?"_
- _"Show me every dessert we photographed in restaurants"_
- _"Which wine did we have at Noma?"_
- _"Where were we on 4 October 2016?"_

The assistant answers briefly with the dates and places, and shows the photos. Names are matched loosely: _noma_ finds _Noma Australia_, and accents, case and plurals don't matter. A person counts as there when they appear on any photo taken during the visit, not only on the photos of the dishes. When you open the assistant, it suggests questions about your own collections, such as the last restaurants you named.

Keep in mind:

- **Only named photos count.** The answers come from the tags of the collections, so a meal whose dishes were never named isn't in them. The assistant then searches your other photos by meaning, date and place, and says when the answer may be incomplete, such as _"only named dishes are counted"_.
- **Names, not meanings.** _Dessert_ finds _Citrus Pre-Dessert_, but not _Rum lamington_. The assistant asks with synonyms, and can search the photos by what they show.
- **Only your own photos**, in the timeline and the archive, are read; locked, hidden and trashed photos, and the photos of partners and shared albums, are not.
- **Travel stays private.** The names of legs are redacted as everywhere else, and travel documents are never shown.

The assistant uses the `query_collections` and `summarize_collections` tools for this, and the web app the `GET /collections/summary` endpoint.

### Asking from the search bar

You can also type a question straight into the search bar, such as _"what did we eat at noma"_ or _"which museums did we visit in 2025?"_. A search counts as a question when it has a question mark or starts with a question word (what, which, when, where, who, how, did…); no AI decides that. The usual results show at once, as for any search, and never wait for the assistant. Beside them:

- **From your collections** lists the visits whose names match the question (the restaurant, the dishes, the museum), found without AI from its words: _eat_ points to food, _museums_ to museum visits, a year to that year, and the words left are looked for in the names. Each visit links to its tag.
- **Answer from the assistant** streams in when the assistant is enabled: a short answer with the dates and places, followed by the photos and the tags it used, as thumbnails and tag chips. **Stop** cancels it, and **Continue in chat** opens it as a chat, where you can ask a follow-up. Each answer is a chat of its own, titled with the question, in the **Assistant** page.

To turn the answers off, select **×** on the panel, or turn off **Answers in search** under **Account Settings → Features**. The results and the collection matches stay.

## Photos are never changed

Everything the assistant and the related tools make is a **new photo**, stacked with the original, which stays the primary photo of the stack. The copy keeps the original's date, location and camera. Each copy is tagged automatically, so you can find it later:

| Copy                                                       | Tag                  |
| ---------------------------------------------------------- | -------------------- |
| Cropped                                                    | `Edits/Cropped`      |
| Straightened                                               | `Edits/Straightened` |
| Enhanced                                                   | `Edits/Enhanced`     |
| Improved (straightened, cropped and/or enhanced in one go) | `Edits/Improved`     |
| Artwork                                                    | `AI Artwork/<style>` |
| Map image made for a photo book                            | `Photo books/Maps`   |

Crops inside a photo book are stored in the book only; they don't create copies.

### Photos you don't own

Photos that are only shared with you, such as the photos other members added to a shared space, or a partner's, are read-only for these features, even when you're an **Editor** of the space:

- **Use them** in photo books, collages and highlight videos, as long as you can see them.
- **Copies are made of your own photos only.** Crop, straighten, auto-enhance, improve and artistic styles (testing a style too) work on your own photos, and the photo viewer only offers them there. When a book improves its photos or illustrates a map, the photos of others are laid out as they are.
- **Naming is for your own photos only.** The **Name the …** dialogs and the assistant only tag and describe the photos you own. The photos of others in a visit still help to read the names, such as a menu a friend photographed, and the dialog says how many photos it leaves as they are.
- **Sharing a book** with photos of others goes through their shared space, see [Sharing a book](#sharing-a-book).

### Picking photos on what they can become

When the assistant picks the best photos for an album or a book, it doesn't only look at the photos as they are. It also considers how they would look after the fixes Gallery can make: straightening, a tighter crop and auto-enhance. These fixes are tried on small previews first, without creating anything. A slightly dark, color-cast, tilted or loosely framed photo of a great moment is no longer beaten by a clean but dull one. Blurry photos still lose, because blur can't be fixed.

For the photos it picks that a fix measurably helps, the assistant then creates an improved copy (stacked with the original and tagged `Edits/Improved`) and uses it in the album or book. It tells you which photos it improved.

## Photo books

Photo books are listed on the **Photo books** page in the sidebar. You can create them with one click from an album, or ask the assistant.

### Export an album as a book

Open an album and choose **Export as book…**. The pages are laid out automatically, and you can review and change the book afterwards. The dialog has these options:

- **Title** and **Subtitle**, shown on the cover. The title defaults to the album name.
- **Page size**: **Square 21 × 21 cm** (default), **A4 portrait**, **A4 landscape** or **Square 30 × 30 cm**.
- **Style**: **Soft** (default; warm cream pages, muted brown text, generous margins and a serif font), **Classic** (white pages, 12 mm margins and a serif font), **Bold** (small margins, tight gutters and a sans-serif font, made for full-bleed photos) or **Food** (like a printed menu, for an album of restaurant meals; see [Food books](#food-books)).
- **Number of pages**: optional. The dialog suggests about three photos per page plus the cover, rounded to an even number, up to 200. Leave it empty to let the layout decide.
- **Include maps**: opens the sections that have GPS locations with a map page. When it's on, choose the **Map style** and whether to **Illustrate maps with AI** (see [Map pages](#map-pages)).
- **Improve photos (enhance, straighten and crop)**: on by default. Photos that measurably benefit get an improved copy, stacked with the original, and the book uses the copy.
- **Format**: **PDF**, **HTML (single file)** or **Both**.

Select **Create book**. A progress dialog shows the export; it keeps running if you close it, and you get a notification when the file is ready.

Captions are drafted automatically from facts only: the place, when it changes. They never describe what a photo looks like. The assistant can also caption with the place and time, or the place and the people's names.

### How the automatic layout works

- **Cover and chapters.** The book starts with a cover, then one section per event. Small events are merged, and a single day is split into chapters by its own gaps and distances, such as the stops of a ride. Each section opens with a map (when the photos have GPS) or a section title.
- **One photo per stack.** Near-duplicate bursts are narrowed down to the best photo, and each stack appears once: the original, or a copy that is clearly better.
- **Artwork is limited.** At most about one page in five shows artwork, never on two pages in a row. An artwork can appear next to its original as a deliberate pair, at most twice per book.
- **Sizing by resolution.** A photo is never placed in a slot it can't print at 150 dpi. Important photos (favorites, high scores, faces) get whole pages or large slots, and the others fill denser layouts.
- **Variety.** Crops never cut faces. The layout avoids repeating layouts, more than two single-photo pages in a row, and similar photos on neighbouring pages.
- **People.** The main people of the album are kept in every section.

If there are more photos than pages, the less important ones are left out.

### The book viewer

Open a book to see its pages. Switch between **Spread** (facing pages, as in a printed book) and **Single page**. The toolbar has:

- **Preview**: shows the book as the single-file web book, with page turning. You can also open it in a new tab.
- **Edit with assistant**: opens a chat about this book. The assistant asks for approval before it edits a book it didn't create in that chat.
- **Re-layout automatically**: lays out all pages again, with the number of pages and the map options. This replaces every page, including changes made by hand or with the assistant.
- **Style**: applies the **Soft**, **Classic**, **Bold** or **Food** preset. A book changed by hand or by the assistant shows **Custom**, and applying a preset replaces its custom margins, colors and fonts.
- **Review**: checks the book (see below). A badge shows the number of problems to fix.
- **Export**: exports or downloads the PDF and HTML files. An export is marked **Outdated** when the book changed since.

#### Review

**Review** opens the **Book review** panel. It checks the book again after every change, and sorts problems into **Must fix**, **Should fix** and **Could be better**:

- **Same photo more than once**: the same photo, or a copy of it (crop, artwork, enhanced or improved copy), on several pages.
- **Low print resolution**: a photo that prints below 150 dpi in its slot.
- **Empty photo slot**.
- **Too much artwork**: more than about one page in five.
- **Artwork on neighbouring pages**.
- **Many single-photo pages in a row**.
- **Similar photos close together**: very similar photos on neighbouring or facing pages.
- **Map style not available**: a styled map while the map is turned off or its data can't be loaded, or a map style that needs a Stadia Maps key, drawn as a sketch instead.
- **Person rarely shown**: a main person who appears in many album photos but few book photos.
- **Many artwork pairs**: too many pages that pair a photo with its own copy or artwork.
- **Repeated layout**: neighbouring pages with the same layout.
- **Missing captions**.
- **Could look better after enhancing**: placed photos that an improved copy would clearly help.
- **Dish without its name** and **Restaurant without its menu**: the checks of [food books](#food-books).

The panel also lists the **People** of the album with how often they appear, the **Good photos not used**, and the **Weakest photos in the book** to compare them with. Use **Fix with assistant**, **Fix all with assistant** or **Use them with assistant** to hand the problems to the assistant, and **Check again** to refresh.

#### Edit pages

Select **Edit pages** to change the book by hand:

- Select a photo on the page to **Replace photo**, **Add photo** (in an empty slot), **Adjust crop**, **Reset crop**, **Move to…** another slot, **Remove photo**, or edit its **Photo caption**.
- Drag photos onto each other to swap them.
- **Change layout** of a page. The photos move to the slots of the new layout.
- Edit the **Page caption** and **Section title**.
- In the page strip, **Add a page** after a page (choosing its layout), **Delete page**, **Move page earlier** or **Move page later**, or drag pages to reorder them.

When you replace or add a photo, you can search your library or show **Only photos of the album**. The crop editor lets you drag the photo, zoom with the slider, the mouse wheel or the + and - keys, and move it with the arrow keys.

### Exporting

- **PDF**: a print-ready file with every page rendered at 300 dpi.
- **HTML (single file)**: one self-contained web page with the photos embedded, which works offline and makes no external requests. It can be shared or emailed, and turns pages like a book. Photos are sized for sharp screens (up to 2000 pixels), not for print. You're warned when the file is over 60 MB, since it may be too large to email.

Both exports run in the background and send a notification when they're done. Download them from **Export → Download PDF** or **Download HTML**.

### Sharing a book

Select **Share** in the book viewer to create a public link to the book, like a shared album link. Choose when the link expires, a password, a custom URL and whether visitors can download the PDF, then copy the link or show it as a QR code.

People with the link see the title of the book and the page-turning web book, full screen and on phones too, with a **Download PDF** button when downloads are allowed and the PDF has been exported. The web book is built from the current pages, so later edits show up without a new link. Turn off **Show metadata** to leave out the file names of the photos and the dates of the book.

A book link shows only that book. Its pages are drawn on your server, and the photos in it aren't shared one by one, so the link doesn't give access to them, to the album, or to any other book. Manage your links under **Sharing → Shared links**, on the **Photo books** tab, where you can edit or delete them. Deleting the book also deletes its links.

A book can show photos of a shared space that other members added. A link to such a book is tied to the space those photos are in, which is found for you, and only an **Owner** or **Editor** of the space can create it. The link shows those photos only while they stay in the space and you stay an Owner or Editor of it: once a photo is taken out of the space, or you become a Viewer or leave, the pages and the web book leave it out, and the PDF is no longer offered. A book whose photos of others aren't all in one space you can edit can't be shared with a link. A link made before links were tied to a space shows only your own photos; share the book again to show the others.

You can also ask the assistant to share a book. It uses `share_book`, which asks for approval, can set an expiry and a password, and replies with the link.

:::caution
Anyone with the link can read the book, so check what the pages show before you share it. A page that prints a travel document shows it to the visitors too.
:::

### Suggested books

Every night, Gallery looks for books your photos are enough for, and drafts them in the background for you to review. The drafts are laid out by the server's own automatic layout, like **Export as book**: no assistant is involved, nothing leaves your server, and it costs no AI credits.

| Kind              | Example                                                                                  | Drafted when                                                                                                                                                                                              | Style                        |
| ----------------- | ---------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| Yearly collection | "2026 in food", "Museums we visited in 2025", "2025 in the kitchen", "Cellar notes 2025" | The year is over, and it has at least 3 visits (meals, museum visits, cooking sessions or tastings) and 15 named photos (dishes, artworks, bottles) of that [collection](#tags).                          | The collection's book style  |
| Trip              | "Crete, October 2016", "Our trip to Évora"                                               | A trip tagged `Travel/<Trip>`, or, without travel tags, the days away from home (more than 80 km from the place you photograph most). The trip is over, spans at least 2 days and has at least 40 photos. | Travel, or Classic with maps |
| Birthday          | "Maya turns 7"                                                                           | A named person with a birth date has at least 30 photos in the year that ended on their latest birthday (the birthday included).                                                                          | Soft                         |

When a draft is ready you get a notification, "A new photo book is ready to review: 2026 in food", which opens it. On the **Photo books** page, drafts wait in a **Suggested for you** row with their cover, why they were suggested ("You visited 6 restaurants in 2026…") and two buttons:

- **Keep** makes the draft one of your books. Until then, drafts aren't in the list of books or in the sidebar.
- **Discard** deletes the draft. It is never suggested again, and neither is a draft you delete from the book viewer.

Open a draft to look at its pages. The viewer shows a banner with the same buttons, and **Polish with assistant**, which opens a chat to review the book, swap in better photos and write captions.

Every suggestion is made once. At most 3 books are drafted per night for each user (**Books per night**), and none while 6 drafts are waiting to be reviewed. You can also ask the assistant "what books have you made for me?": it lists the drafts with `list_book_drafts`, and keeps or discards one with `keep_book_draft` or `discard_book_draft`, which ask for approval.

Turn suggestions off for yourself under **Account Settings > Features > Suggested books**. Administrators can turn them off for everyone, or choose the kinds, in **Administration > Settings > Photo books**, and draft books now with **Draft suggested books** under **Administration > Jobs > Create job**.

### Map pages

Map pages show the route, the numbered stops, place names, a compass, a scale bar and the section title. Choose the **Map style** when you create or re-lay out a book, or for one map page in **Edit pages**. Each style shows a small preview of the map, drawn by the server:

- **Styled map** (recommended, and the default): the real streets, water, parks, forests, railways and place names, drawn in the look of the book. It uses the same map data as Gallery's own **Map** page, from the tile server set in **Administration > Settings > Map** (by default the OpenStreetMap-based tiles of `tiles.immich.cloud`), with the credit _© OpenStreetMap contributors_ on the page. A walk in a town shows the streets around it, and a road trip or an island shows its coast, sea and towns. The look follows the style of the book, or you can choose one:
  - **Watercolor wash**: soft washes of water and parks with hand-drawn edges on warm paper; for the Soft, Food and Cookbook styles and your own styles with warm paper.
  - **Engraved atlas**: fine ink coasts with water lines, hatched woods and sepia land; for the Classic and Cellar notes (wine) styles.
  - **Minimal**: thin grey lines on white with small sans-serif labels; for the Gallery (museum) and Bold styles.
  - **Vintage chart**: cream and navy, with a compass rose, a latitude and longitude grid and a stamp-red route; for the Travel style.
- **Sketch (offline)**: a route on paper, drawn on your server, with the coastlines of large areas. No locations are sent to a map provider.
- **Watercolor**, **Toner** and **Terrain**: the Stamen styles from [Stadia Maps](https://stadiamaps.com). They need a Stadia Maps API key in the admin settings; without one they can't be chosen.
- **Auto**: the default style chosen by your administrator (styled, unless changed). The assistant uses it when you don't ask for a style.

Styled maps are drawn at the print resolution of the PDF (300 dpi), for the rendered pages, the PDF, the HTML book, the preview and the map cards of [highlight videos](#highlight-videos). Books made before styled maps keep their style.

:::info Map tiles and privacy
A styled map asks the tile server of the Map page for the area of the page (at most about 20 tiles, which are then kept for 30 days in a cache under the thumbnails folder), as the Map page does when you look at a place. The request carries no personal data, only the area and a generic User-Agent. The watercolor, toner and terrain styles send the area of the trip to Stadia Maps.

When the map is turned off in **Administration > Settings > Map**, or its data can't be loaded (the tile server is down, too slow or blocked), a styled map is drawn as the offline sketch instead, and the review of the book (see [The book viewer](#the-book-viewer)) reports **Map style not available**. Without an API key, or when their tiles can't be downloaded, the Stadia styles also fall back to the sketch.
:::

**Illustrate maps with AI** (or **Illustrated by AI** for one page in **Edit pages**) asks the [art agent](#artistic-styles) to paint over each map page as a hand-illustrated vintage watercolor travel map, keeping the geography, route, pins and place names. It needs an art profile and adds a few minutes per map. The rendered map is saved as a photo tagged `Photo books/Maps`, and the illustration is stacked with it.

## Highlight videos

A highlight video is a short film of a trip, a dinner or a museum visit: a book laid out in time. Select **Make a highlight video…** in the **⋮** menu of an album, in the **Export** menu of the book viewer, or in the menu of a selection of photos and videos. Choose:

- **Title**: shown on the title card; the name of the album or book by default.
- **Length**: 30, 60, 90 or 120 seconds. The film is exactly that long, unless there are too few photos to fill it.
- **Shape**: **Landscape 16:9** (1920×1080) for a TV or a computer, or **Vertical 9:16** (1080×1920) for phones, stories, reels and messages (see [Vertical videos](#vertical-videos)).
- **Style**: the look of the title cards and captions, from the [book styles](#photo-books). **Automatic** uses the style of the book, or the style of the collection the photos belong to, so a food video looks like a food book and a museum video like an exhibition catalogue.
- **Maps**: open each chapter that has GPS locations with a map.
- **Captions**: name the dishes, artworks, wines and recipe steps, and the places, in a label at the bottom of the photos.
- **Music**: an audio file you uploaded (MP3, M4A, AAC, WAV, FLAC, OGG or Opus), or none. Gallery includes no music, so videos are silent unless you upload your own.

The video picks and orders its photos like the [automatic book layout](#how-the-automatic-layout-works): one photo per stack and per burst, the best ones first, and a chapter per day or stop (or per restaurant visit, recipe, tasting, museum visit or leg of a trip). Each chapter opens with a map or a title card with its place and dates. Photos slowly zoom towards the faces, or towards the most interesting part of the photo when there are none, and never crop a face out of the frame; portraits are shown whole over a blurred copy of themselves. Short clips of 3 to 5 seconds are cut from the best part of the videos, with their sound. Travel documents and menus are never shown.

The video is rendered in the background, with its progress in the corner of the screen, where you can also cancel it. When it's done you get a notification, _Your highlight video is ready_, and the video opens. A card in the corner stays until you close it, with **Share**, **Download** and **Open**. **Share** sends the file itself to another app (WhatsApp, Instagram, Messages…) where the browser can share files, as on phones; elsewhere it downloads it. It's saved as a new 1080p video (MP4, H.264 and AAC) in your timeline, dated like the last photo of the trip, tagged `Highlights/<title>`, and added to the album it was made from. Gallery then makes its thumbnails and transcodes it like any other video.

Rendering takes about half a minute to a few minutes on the CPU, depending on the length and the number of clips. When your administrator turns on hardware acceleration for [video transcoding](/features/hardware-transcoding), the film is encoded on the GPU, and on the CPU if that fails.

You can also ask the assistant: _"make a one-minute video of our trip to Sicily"_. It uses `make_highlight_video`, which asks for approval, and tells you when the video is ready.

### Vertical videos

A vertical video is made from the same photos, chapters and length as a landscape one, framed for a phone held upright:

- Portrait photos fill the frame.
- Landscape photos are cropped to 9:16 around their subject: the faces, or the most interesting part of the photo when there are none. When that crop would cut a face, keep less than about a third of the photo (16:9 photos and panoramas), or enlarge a small photo too much, the photo is shown whole over a blurred copy of itself instead.
- The slow zooms are planned in portrait and keep every face in the frame.
- Portrait clips fill the frame; landscape clips are shown whole over a blurred copy of themselves.
- The title cards, chapter cards and captions use larger text and stay out of the top 14% and the bottom 20% of the frame, where social apps show the account name, the caption and their buttons. Maps are drawn at 9:16, with their title, compass, scale and route in the same safe band, and [styled maps](#map-pages) keep their look.

The file is named `<title>-vertical.mp4`, and the video is described as a vertical highlight video. Ask the assistant for _"a vertical video for my Instagram story"_ and it passes `format: vertical`.

## Collages

A collage puts 2 to 9 photos on one page. Select the photos in the timeline or in an album, then **Make a collage…** in the **⋮** menu. The dialog shows a live preview drawn by the server, and lets you choose:

- **Aspect ratio**: 1:1 (square), 4:5 (portrait, e.g. for a feed), 9:16 (a phone screen or a story) or 16:9 (a screen).
- **Layout**: the layouts for that number of photos, from the [photo book](#photo-books) catalogue plus denser ones made for collages. The one that fits your photos best comes first: portrait photos go into tall slots and landscapes into wide ones, and faces are kept whole. **Shuffle layout** goes through the others.
- **Style**: a book style preset, or one of [your own styles](#designing-your-own-styles), with its margins, gaps, page colour and font.
- **Title**: optional, drawn in a band at the foot of the collage.

**Download** saves the collage (3000 pixels on the long side) to your computer. **Save collage** adds it to your timeline as a new photo, dated like its last photo and tagged `Collages/<title>` (or `Collages/<dates>` without a title), then opens it. A collage made in an album you can add to is added to that album. The photos themselves are never changed.

You can also ask the assistant, e.g. _"suggest collages of our trip, the best 4 photos of each day"_. It picks the photos, previews the collages with `preview_collage`, and saves the ones you agree to with `make_collage`, which asks for approval.

## Artistic styles

Artistic styles are made by the **art agent**: an ACP agent whose model can generate images, such as Codex. An administrator chooses it as the **Art profile**. The art agent receives the preview of the photo and a prompt, and returns one image. It gets no Gallery tools.

Open a photo you own and choose **Artistic style…** from the menu, or ask the assistant. Pick a style:

- Editorial watercolor split
- Watercolor
- Gouache travel poster
- Vintage lithograph
- Colored pencil + ink
- Pen-and-wash sketch
- Oil pastel
- Impressionist painting
- Japanese woodblock
- Cyanotype
- Vintage Polaroid
- 35mm editorial film
- Risograph print
- Linocut
- Charcoal + pastel
- Graphite field sketch
- Cut-paper collage
- Botanical plate

Or choose **Custom** and describe the artwork in your own words. For the other styles, the optional **Custom prompt** adds extra instructions, such as _warmer colors, keep the sky empty_.

The **Editorial watercolor split**, **Gouache travel poster**, **Vintage lithograph** and **Botanical plate** styles write a short **Caption** into the artwork. Leave it empty to let the agent choose one that fits the scene.

Select **Generate**. It usually takes 30 seconds to 2 minutes, and stops after 10 minutes. You can **Close (keeps running)**: a notification tells you when the artwork is ready or if it failed. The artwork is a new photo stacked with the original and tagged `AI Artwork/<style name>`.

- **Upscaling**: generated images are often too small for a printed page. When the long edge is under 2400 pixels, the artwork is upscaled to twice its size, between 2400 and 3000 pixels.
- **Editorial watercolor split**: image generation redraws a photo instead of keeping it. So the art agent only paints the watercolor half, and Gallery places your untouched original photo above it.

## Designing your own styles

When no built-in style is quite right, the assistant can design one with you. You describe a look in words, the assistant designs it and shows you a sample, and it saves the style as one of **your styles**, listed next to the built-in ones.

Choose **Create with assistant…** in any of these places:

- the **Style** menu of a book
- the style picker of **Export as a book**
- the **Artistic style** dialog of a photo

Describe the style you want, or start from one of the examples, and select **Open the assistant**. The chat opens with the request written for you, with the current book and some of its photos, or the photo, already attached.

### Book styles

The assistant asks about the mood first, for example calm or bold, light or dark pages, or vintage or modern. When you mention colours or photos, as in _our wedding colours_ or _the colours of these photos_, it reads the main and accent colours of those photos with `get_photo_palette`.

It then renders the cover and first spread of your book, or a sample book of your photos, in the proposed style with `preview_book_style`. It looks at the result, adjusts the style, and shows you the preview. Nothing is saved until you approve the style. `save_book_style` saves it, and `apply_book_style` applies it to a book. Both ask for your approval.

Designed styles use the same options as the presets, and they are checked strictly:

- **Fonts**: only the fonts that render on your server and in the exports, such as the serif, sans-serif and typewriter families and FreeSerif, DejaVu and Noto.
- **Colours**: opaque colours only. The text must be readable on the page, with a contrast of at least 3:1 (4.5:1 reads well), and the accent must stay visible.
- **Sizes**: margins, gutters and text sizes that print well, with captions smaller than titles.
- **Theme**: plain, or the look of one of the collection books. The printed look adds a thin frame, rules, ornaments and small caps in the accent colour. The gallery look shows every photo whole, with museum-label captions.

Applying one of your styles copies it into the book. If you change or delete the style later, the book keeps its look.

### Artistic styles

The assistant writes the prompt in the same way as the built-in styles. It turns the photo into the new medium, keeps the scene and its people recognizable, and describes the materials, marks and colours. It asks which photo to try the style on, tests it there with `test_art_style`, and shows you the artwork. Then it refines the prompt with you until you like the result, and saves it with `save_art_style`.

Each test is an art job. Its artwork is saved as a new photo stacked with the original, described as a style test and tagged `AI Artwork/Style tests`, so you can find and delete the tests afterwards. Prompts are between 80 and 2000 characters long. A style can write a caption into the artwork, and it can paint only the lower half with your untouched photo above it, like the **Editorial watercolor split**.

### Managing your styles

- **Book styles** appear under **Your styles** in the Style menu and in the export dialog. Rename or delete them in **Photo books → Manage styles**.
- **Artistic styles** appear under **Your styles** in the Artistic style dialog. Select one to generate artwork, or delete it with its trash icon. Artwork you made with a deleted style is kept.

Your styles are private to your account. Other users, and people with a shared link, can't see them.

## Auto-enhance and straighten

Enhancing and straightening use local image processing on your server. No AI is involved and nothing is sent anywhere.

### Auto enhance

Open a photo you own and choose **Auto enhance** from the menu. It works even when the assistant is disabled. It analyzes the photo and applies only the corrections it needs:

- noise reduction, for photos taken at a high ISO;
- white balance, to neutralize a color cast;
- auto levels (black and white points);
- exposure of the midtones (brighter or darker);
- local contrast;
- saturation, for more vivid colors;
- sharpening.

Choose a **Strength**: **Subtle**, **Normal** (default) or **Strong**. The dialog shows a **Before and after** preview and lists each correction with the reason for it. **Save enhanced copy** saves the result at full resolution as a new photo, tagged `Edits/Enhanced`.

GIF, SVG and panorama images can't be enhanced.

### Straighten

The assistant measures how tilted a photo is from its level and plumb lines, such as horizons, buildings, poles and door frames. It suggests straightening only for small tilts that it measures with confidence: at least 0.4° (smaller tilts aren't visible) and at most 8°. Larger angles are usually perspective lines, such as a table or a shop front, and are left alone. So are photos whose lines already look level. When photos are improved automatically, only tilts up to 4° are corrected.

A straightened copy keeps the original shape and crops away the blank corners, and it is tagged `Edits/Straightened`.

## Sideways and upside-down photos

Gallery looks for photos that are stored sideways (turned 90° either way) or upside down, and lists them under **Utilities → Fix photo orientation**. It needs smart search (CLIP) to be enabled; face detection and OCR make it more reliable. For each photo it compares the preview in its four turns with CLIP, then reads the faces (they should be upright) and the text (it should read left to right) of the turn it prefers. Only confident cases are suggested, each with the turn, how sure it is and why.

- **Every night**, the photos uploaded since the night before are checked, up to 500 per user (the first night, the uploads of the last 30 days).
- **Check photos** checks all your photos (newest first, up to 5000 at a time), those of an album, or those taken between two dates, in the background.

On the page, each photo is shown turned as suggested. **Turn upright** fixes one, **Keep as it is** rejects the suggestion (it isn't made again), and **Fix all** fixes every photo on the list. A fix is an edit, the same as the rotate button of the photo editor: no copy is made, the photo's other edits are kept, and **Undo** (under **Fixed**) or the editor turns it back. Photos you have already edited, videos, live photos, panoramas and GIFs are not checked or turned.

You can also ask the assistant: _"find the sideways photos of our trip and fix them"_. It uses `find_rotated_photos`, which lists the suggestions or checks an album, a date range or chosen photos on the spot, and `fix_rotation`, which asks for approval.

On a benchmark of 37 upright photos from the demo library (a trip to Sicily and three restaurant meals) turned every way, it fixes 96 of the 111 turned cases, never turns a photo the wrong way, and leaves all 37 upright photos alone. Photos that look the same every way, such as a dish seen from above, are often left unflagged; that is on purpose.

## Food

Gallery can find the restaurant meals among your photos, read the menus you photographed, and suggest which menu item each dish photo shows. You check the names, and Gallery tags the photos by restaurant and dish. A **Food** photo book then lays them out like a printed menu.

It uses the smart search (CLIP) and OCR models of your server: nothing is sent anywhere, unless you ask the [assistant](#the-assistant) for help or turn on the [OpenStreetMap lookup](#restaurant-names). Without smart search, dishes can't be recognized, so **Name the dishes…** isn't shown.

### Name the dishes

Open an album and choose **Name the dishes…** from its menu, or select photos you own and choose **Name the dishes…** from the menu of the selection.

1. **Finding the meals.** Gallery recognizes the photos of dishes and drinks, menus, restaurant signs and receipts, and groups them into meals by time and place. The dialog lists each meal with its **Breakfast**, **Lunch** or **Dinner** time, its place, the name of the restaurant and where the name comes from, and the other names read on the photos. Select a meal to name its dishes. When nothing is found, the dialog says _No food photos found in this album_.
2. **Reading the menu.** The **Menu** photos of the meal are shown first; tap one to see it large. They're read again at full resolution, in overlapping tiles, so that small or thin print isn't missed; tilted menus and menus photographed in several parts are read too. The text read this way is only used for matching, it isn't stored.
3. **Matching the dishes.** Each dish photo is compared with the names and descriptions of the menu items. Photos of the same dish are grouped, and each dish gets a different menu item unless two dishes clearly share one, such as two plates of the same pasta. Every dish has a **Dish** field with the suggested item, where you can choose another item of the menu or type any name:
   - weak matches are highlighted with **Check this match**;
   - dishes that probably aren't on the menu, such as bread, coffee or an amuse-bouche, are marked **Not on the menu** and left for you to name. Tick or untick **Not on the menu** to switch between the menu items and a free name;
   - a dish left without a name is skipped;
   - names you saved before are shown as **Named**.
4. **Naming the restaurant.** The **Restaurant** field is filled with the best name found; select one of the **Other names read** to use it instead, or type the name. See [Restaurant names](#restaurant-names).
5. **Save** tags the menu photos and the named dishes, and tells you how many photos were named.

After saving, **Make a food book** opens **Export as book…** for the album with the **Food** style chosen. When you started from selected photos, it asks the assistant to make the book instead.

**Ask the assistant** opens a new chat with the photos of the meal attached and a request to name its dishes. The assistant has the same tools: it finds the meals, reads the menu, matches the dishes, and then looks at the photos itself to check the matches, especially the unsure ones and the dishes that aren't on the menu. It asks before it saves the names.

### Restaurant names

The name of a restaurant is found locally first, in this order:

1. the food tags already on the photos of the meal;
2. text read on a photo of the restaurant's sign or storefront, of the menu or of the receipt;
3. otherwise a name is made up from the meal and the town, such as _Lunch in Taormina_.

In the last case the dialog says _Couldn't read the restaurant's name. Type it in._ When an administrator turned on the OpenStreetMap lookup, it says _Couldn't read the restaurant's name. Type it in, or ask the assistant to look it up on OpenStreetMap._

The assistant only uses the lookup when it couldn't read the name either. It asks you first: the lookup sends the location of the meal to a public [OpenStreetMap](https://www.openstreetmap.org) service, the [Overpass API](https://wiki.openstreetmap.org/wiki/Overpass_API), which returns the named restaurants, cafés and bars nearby. The assistant then asks you which one it was.

:::info OpenStreetMap and privacy
The lookup is off by default. When it's on, the location of a meal is only sent when the assistant asks to look a restaurant up and you approve it (or when changes are auto-approved). Nothing else is sent, and the photos never are. To keep the locations of your meals off public servers, point **Overpass API URL** at your own Overpass instance.
:::

### Tags and descriptions

Saving gives each photo one food tag, replacing any other food tag it had:

| Photo | Tag                        |
| ----- | -------------------------- |
| Dish  | `Food/<Restaurant>/<Dish>` |
| Menu  | `Food/<Restaurant>/Menu`   |

A `/` in a name is replaced with `-`. A dish named just _Menu_ marks its photo as the menu.

A dish photo without a description gets one, such as _Pasta alla Norma · Trattoria da Nino_, which shows as its caption in the photo viewer. A description you wrote is never changed. Only a description that an earlier naming wrote is updated when you rename the dish.

The tags appear in the **Tags** tree of the sidebar, as `Food` → restaurant → dish. The **Tags** row of **Explore** shows the restaurants, not every dish; select a restaurant to see all its photos.

### Food books

The **Food** style (_Like a printed menu: warm paper, small-caps headings, thin rules and the name of every dish below its photo_) works best with an album whose dishes are named:

- **One chapter per restaurant visit.** The photos tagged with one restaurant make a chapter. Photos of the same restaurant more than 3 hours apart are separate visits, and untagged photos taken up to 20 minutes before or after belong to the visit, such as the table or the view. The photos between the visits are split into chapters as usual.
- **The menu page.** Each visit has one page with its menu photo, after the chapter opener. The other photos of the menu are left out.
- **Dish captions.** The name of each dish is set below its photo, from its food tag. A page of other photos is captioned with their place, as in the other styles.
- **Review.** **Dish without its name** is a named dish shown without its caption. **Restaurant without its menu** is a restaurant whose dishes are in the book but whose menu, which is in the album, isn't.

## Cookbook

The cookbook works like [Food](#food), for the dishes you cook at home. Photograph the recipe (a handwritten card or a page of a cookbook) along with the cooking, and choose **Name the recipe steps…** from the menu of an album or a selection, or ask the assistant.

- **Cooking sessions.** The photos of the ingredients, the steps and the finished dish are grouped by time; the recipe may be photographed up to a day later. Labels such as the brand of the oven don't make a photo a recipe.
- **Reading the recipe.** The title, the serves and time line, the ingredients and the steps are read, even on a page photographed at an angle. Fractions that OCR misreads are repaired where it is clear, such as _11/2 cups_ for 1½ cups. When the page shows other recipes, such as a variant beside it, the one whose title fits the photos is kept and the others are offered as alternatives. A step whose text is off the photo is kept by its number.
- **Matching.** Each photo is matched with a step, in the order of the steps, or with **Result**, the finished dish. The other dishes of the meal are marked as not from this recipe.
- **Tags.** `Recipes/<Recipe>/Step 2: Whisk the eggs` on a step photo, `Recipes/<Recipe>/Result` on the finished dish and `Recipes/<Recipe>/Recipe` on the recipe photo. Step photos without a description get one, such as _2. Whisk the eggs · Quiche_.
- **Cookbook books.** The **Cookbook** style lays out a chapter per recipe, opened by a recipe page: the photo of the recipe with its ingredients and steps typeset below it, read from the photo when the book is laid out (edit the page caption to correct them). The steps are captioned below their photos and the finished dish as _Finished dish_. The review lists recipes without a photo of the finished dish and steps without a photo.

## Wine & drinks journal

Name the bottles you taste, at a winery, a wine bar, a dinner or at home. Choose **Name the wines…** from the menu of an album or a selection, or ask the assistant. Each bottle's label is its own source, so you don't need to photograph a list.

- **Tastings.** Bottles, glasses and pours are grouped by time: a long lunch with a glass every twenty minutes is one tasting. The place is read on a winery's sign, such as _Max Ferd. Richter_, looked up on OpenStreetMap (wineries, wine shops, bars and restaurants, when the admin enabled it), or taken from a [Food](#food) meal photographed at the same time: drinks at a restaurant get the restaurant's name, such as _Noma Australia_.
- **Reading the labels.** Every bottle photo is read at full resolution for the producer, the wine (its vineyard site, cuvée, appellation, grape and style, such as _Brauneberger Juffer Riesling Spätlese_), the vintage (_2009_, _1979er_), the region and the grape. The small print (A.P.Nr., alcohol, volume, sulfites, addresses) and the story on a back label are left out. Labels are set in script fonts and photographed at an angle beside a glass, so OCR often reads only fragments: a name is marked sure only when its producer, wine and vintage were all read clearly. The assistant reads the rest itself from zoomed crops of the labels, which **read_source** and the contact sheet of **match_subjects** show.
- **One bottle, several photos.** Photos of one bottle taken a few minutes apart, such as the label and then the glass, are grouped when their labels agree or they look alike and no label disagrees. Two bottles on the same table look alike, so a different vintage or different words on their labels keep them apart.
- **Wine lists.** When a wine list, a tasting sheet or the pairing of a menu was photographed, the bottles are matched with its lines by the words and vintage their labels share.
- **Tags.** `Wine/<Tasting>/<Producer · Wine · Vintage>` on a bottle photo, leaving out what is unknown (`Wine/Noma Australia/Snakebite`), and `Wine/<Tasting>/Wine list` on a list. Photos without a description get the name, such as _Willi Haag · Brauneberger Juffer Riesling Spätlese · 2009_. Write your own tasting note in the description instead, and books print it.
- **Cellar notes books.** The **Cellar notes** style is a tasting notebook: a chapter per tasting and a tasting-note page per bottle, with its photo and a small typeset fiche of the producer, the wine, the vintage, the region and the grape, then your note from the photo's description, or ruled lines to write one. In a [Food](#food) book, the drinks of a meal are laid out in its chapter, among its dishes. The review lists bottles without a readable name and bottles shown on more than one photo.

## Travel documents

Photograph your boarding passes and tickets on a trip, and Gallery matches the photos of the trip with its legs. Choose **Name the legs of a trip…** from the menu of an album or of selected photos, or ask the assistant. It uses the same smart search and OCR models as [Food](#food), locally.

- **Documents.** Boarding passes, bus, train, ferry and monorail tickets, park and museum tickets and fare receipts are read into legs: the mode, the carrier, the flight or train number, from → to, the date and time, the seat and the class, in English, Greek, Japanese and Chinese. What can't be read is said, such as a date printed vertically, a year that isn't printed or a time written over by hand.
- **Legs.** A leg runs from a little before its departure (the wait at the station or the airport) until the next leg, or the end of its day; the photos between two legs belong to the destination of the earlier one. A document with only a date covers its day, one without a date the day it was photographed. The places and look a photo shares with a leg, such as a ferry's name on its hull, can move it to that leg. Days without documents stay unassigned: name them yourself, such as _Chania day_.
- **Tags.** Photos are tagged `Travel/<Trip>/<Leg>`, such as `Travel/Crete, October 2016/Bus Chania → Sougia, 4 Oct 2016`, and the documents `Travel/<Trip>/Tickets`. Name the trip after its destinations and month.
- **Travel books.** The **Travel** style is a travel journal: a chapter per leg, opened by a ticket stub typeset from the fields of its document, with a route line and a date stamp, then the photos of the leg. Review reports legs without photos, photos no document covers, documents without a date, and a page that prints a document itself.

:::info Travel documents and privacy
Travel documents carry names, booking references (PNRs), ticket and sequence numbers, frequent flyer and SSR codes, and barcodes that encode them. Gallery reads only the fields of the journey, and hides everything else from every name it suggests, saves or prints: `PNR: A41NQS` becomes `PNR: •••`. The assistant never sees the documents, only these redacted fields: the tools that show it photos, contact sheets and book pages leave the documents out or blur them, whether they are tagged as tickets or only read as one. Ticket stubs replace the documents in books. The documents themselves stay in your library, unchanged.
:::

## Museum & gallery visits

Gallery can also find your museum visits: the photos of artworks (paintings, sculptures, objects), the wall labels you photographed next to them, and the museum's signs and tickets. Open an album or select photos and choose **Name the artworks…**. It works like [naming dishes](#name-the-dishes), with the same local models:

- **Reading the labels.** Each wall label is read at full resolution for the title, the artist (with _attributed to_, _workshop of_ and the like), the date (_1544_, _circa 1760_, _14th century_, _XVe siècle_), the medium (_Oil on panel_, _Huile sur toile_) and the inventory number. A label printed in two languages gives one artwork in English, keeping the original title; an explanatory panel gives its title, not its paragraphs; the label of a case gives each of its objects (_A_, _B_, _C_…).
- **Pairing the artworks.** A label is usually photographed a few seconds after its artwork, sometimes before it. Each artwork is paired with the label photographed next to it, which the smart search then confirms or corrects. Details of one painting share its label, an artwork without a label is marked **No label** for you to name, and labels that no artwork matched are reported.
- **The museum.** The name is read on a sign, a label or a ticket; otherwise it's made up from the town, such as _Museum visit in Florence_. With the [OpenStreetMap lookup](#restaurant-names) turned on, the assistant can look up the museums and galleries nearby, after asking you.

Saving tags each artwork `Art/<Museum>/<Title — Artist, Date, Medium>` (the parts that aren't known are left out) and each label `Art/<Museum>/Label`, and gives an artwork without a description one such as _Virgin and Child · Nicolau Chanterene, 1535-1540 · Museu de Évora_.

The **Gallery** style (_Like an exhibition catalogue: white pages, every artwork shown whole with a museum-label caption and its catalogue number_) makes a chapter per museum visit, opened by the museum's name and the date. Artworks are never cropped: each slot fits its photo. Every artwork is captioned like a museum label (its number in the book, the title in italics, then the artist, the date and the medium), and the label photos stay out of the book, as the captions say what they say. The review reports artworks without their caption and artworks that are cropped.

## Reading log

Photograph the cover, the spine or the title page of the books you read, and choose **Name the books…** or ask the assistant. Each page is its own source, like a wine label.

- **Reading the pages.** The title is the largest type near the top, with the lines set close to it (_Wanderungen / in den / Dolomiten_); the author follows _von_ or _by_, a genre line such as _Roman_, or is a line of name-like words (_ZANE GREY_, _PAUL · L · FORD_). The year, the publisher and the place come from the foot of the page. Library stamps, shelf marks and the reviews on a dust jacket are left out.
- **Fraktur.** Blackletter is read as other letters (_Rumft mmd Proletariat_ for _Kunst und Proletariat_): such a page is never sure, and the assistant reads it on the zoomed crop. A book open at a page without its title gets no name.
- **One book, two photos.** The cover and the title page of one book, photographed a minute apart, are grouped by the words of their titles; two books of one author stay apart.
- **Reading periods.** The books of a calendar year are one period, such as _Reading 2024_, or take the name of the library or bookshop whose sign was photographed with them.
- **Tags and books.** `Reading/<Year or place>/<Title — Author>`, with a reading list as `…/Reading list`. The **Reading journal** style has a chapter per period and a page per book: the cover with its title, author and the date it was read beside it, and your note from the photo's description, or ruled lines to write one.

## Kids' art

An archive of your children's drawings, paintings, crafts and illustrated letters. Choose **Name the artworks…** or ask the assistant.

- **What is read.** A greeting (_Buon Natale_), an age or a year written on an artwork names it, such as _Buon Natale (1947)_. Children's writing is read in fragments, and Cyrillic or Japanese not at all, so most artworks are named by the assistant from what they show, and nothing is marked sure unless it was read letter for letter. The pages of a letter, whose text runs on from one page to the next, are one artwork.
- **Years.** The artworks of a calendar year are one visit; a year with the artworks of two children is split by the assistant with you. A scan has the date it was imported: the assistant takes the year written on the artwork, or asks.
- **Tags and books.** `Kids art/<Child or family, year>/<Title (age N)>`, such as `Kids art/Lina, 2025/Two foxes under green leaves (age 8)`. The **Refrigerator gallery** style shows every artwork whole on a white paper mat, taped to warm paper or held by photo corners, with a handwritten-style label of its title, age and date, and a chapter per child and year. The label font is Patrick Hand or Comic Neue where installed, else the sans-serif.

:::info Kids' art and privacy
The pack is for artworks, never for photos of the children: the smart search is told a photo of a child is something else, the assistant is told never to name one, and the book review reports any photo of the set with a face on it. At most the first name of a child is kept: every name read on an artwork or passed by the assistant keeps one word of a person's name (the given name of a name signed surname first, such as _Rossi Marco_), and the child of a place `<child>, <year>` keeps one word, so no full name reaches a tag, a description or a book. Type titles in sentence case, as runs of capitalized words are read as names. Places are never read on the photos or looked up, books show no map and no city, and the review also reports a caption that reads like a full name and a map page.
:::

## Garden journal

Follow the plants of your garden over seasons and years, from their seed packets and plant tags. Choose **Name the plants…** or ask the assistant.

- **Tags and packets.** A seed packet is read into its crop and variety, such as _Lettuce 'Anuenue'_. Embossed metal tags read nothing: the assistant reads them on the photos and passes the varieties back, one per tag photo.
- **Following the plants.** A photo belongs to the plant whose tag was photographed just before it; a photo of a whole plant after a close-up is the next plant. The photos of a variety on every round of the garden are one plant over the years. A plant without a tag that day stays unnamed, with the plants it looks most like as suggestions: fruit trees of one kind look alike, so check them.
- **Growth stages.** Where the smart search can tell it (flowering, fruit, seedlings, bolting, seeds), the stage goes into the description, such as _Peach 'Tropic Prince' · flowering_.
- **Tags and books.** `Garden/<Garden>/<Plant variety>`, with `…/Tag` or `…/Seed packet` on the sources; the garden is one visit over the years. The **Garden journal** style has a chapter per plant, opened by its tag, and growth-timeline pages of its dated photos in order, each with its stage.

## Concerts

Photograph the setlist, the line-up or the board of stage times at a gig or a festival, and Gallery names your stage photos after the acts. Choose **Name the acts…** from the menu of an album or a selection, or ask the assistant.

- **Gigs.** The photos of a night are grouped by time and place: a festival's stages can be far apart, and a gig has long changeovers. At a festival, pass the line-ups of the other days too: a stage banner often lists the whole week.
- **Reading the sources.** A line-up gives each act its day and start, such as _Saturday 19:30 · Night Pro_, and a board of stage times its start and stage, such as _20:45 · Seat_. A setlist gives its band and the acts billed with it (_Sidney Gish w/ The Beths_), the date, the city and the venue, then the songs. A setlist of songs only is shown as _(setlist: Future Me, Knees Deep …)_ and goes to the next act on the bill.
- **Matching.** A photo belongs to the act on stage when it was taken. A set lasts until the next act of its stage, at most 75 minutes. Among the acts on stage at that moment, the stage name the photo reads on a banner (_SEAT_), where the photos of that stage were taken and what they look like decide. At a club gig, the photos follow the order of the bill, each near the setlist of its act. At a festival, the acts of the stages no source lists are playing too: those photos, and an unlisted opener, are marked **Not on the bill**.
- **Tags.** `Concerts/<Festival or venue, date>/<Act>`, such as `Concerts/Primavera Sound 2019/Kali Uchis`, with `…/Setlist` on a setlist and `…/Line-up` on a line-up or a board. The venue is read on a setlist, a ticket or a sign, or looked up on OpenStreetMap (clubs, music venues, theatres and stadiums) when the admin turned the lookup on.
- **Gig poster books.** The **Gig poster** style uses dark paper with a hot-pink accent and makes a chapter per act. A chapter opens with its setlist (or line-up) typeset in bold capitals beside the photo of the sheet: the songs are numbered, and the acts of a line-up are listed with their starts under their days. Edit the page caption to correct what OCR misread. Handwritten setlists are often read in fragments.

## Nature field guide

Name the plants and animals you photograph in botanical gardens, arboretums and zoos from the labels beside them. Choose **Name the plants and animals…** from the menu of an album or a selection, or ask the assistant.

- **Reading the labels.** From the engraved accession tag of a tree, Gallery reads the scientific name, the family, the common name, where the species comes from and the garden's code, such as _Kahanu_. From a zoo plaque, it reads the common name as its title. The chalk label of a rose gives its cultivar and its kind, colour and scent, such as a floribunda, even when OCR misreads a letter (_FLORISUNDA_). Handwriting is kept as read (_Lady Madmalade_): correct it when you save.
- **Pairing.** A label is photographed a few seconds before or after its plant, and several photos of one plant (its habit, flowers, fruit and bark) share its label. A species labelled on two trees is paired with each label. Plants without a label are marked **No label**.
- **Tags.** `Nature/<Garden or zoo>/<Common name (Scientific name, Family)>`, such as `Nature/Kahanu/Moreton Bay Chestnut (Castanospermum australe, Fabaceae)` or `Nature/Copped Hall/Rose 'Proper Job' (Rosa)`, with `…/Label` on the labels. The garden is read on a sign or the accession tags, or looked up on OpenStreetMap (gardens, parks, zoos and protected areas).
- **Field guide books.** The **Field guide** style uses cream paper and fine ink, with a chapter per walk. Every plant or animal is shown whole as a numbered plate, captioned with its scientific name in italics, then its common name and its family. The label photos stay out of the book. The review reports plates without a scientific name.

## New collection found

Every night Gallery looks at the photos you uploaded since the last check (at most 14 days back) for new visits of the collections: a meal, a museum visit, a tasting, a cooking session, a trip, a gig, a garden walk, a garden over the years, a reading period or a year of a child's artworks. A visit that nobody named yet (none of its photos has tags of that collection) gets a notification in the words of its collection, which you click to open the naming dialog on exactly those photos:

- _Name the dishes from last night at Taormina?_
- _Name the artworks from your visit to the Museu de Évora?_
- _Name the wines from your tasting on Saturday?_
- _Name the recipe you cooked yesterday?_
- _Name the legs of your trip to Crete?_

The day is said from today where you take photos (_today_, _last night_, _on Saturday_, _on 12 June_); the place is the one read clearly on the photos, or the town. Text read on travel documents is [redacted](#travel-documents) in the notification, as everywhere else. Like the rest of the collections, it runs on the server's own models and needs smart search.

A visit is notified when it has enough photos of its subjects: 3 dishes or cooking photos, 2 bottles, 5 artworks, or a trip with a travel document (every photo of a trip counts as a trip photo), away from home (at least 50 km from where you take photos on the most days) and with a place or a town to name it after.

Several collections often find the same photos: the stage shots of a gig look like a trip, and the trees of a garden like a garden walk or a breakfast. The collections compete for them: smart search tells how well each collection's descriptions fit each photo (a peach tree fits _fruit on a tree_ better than _a plate of food_), and a visit is notified only when its collection fits most of its photos better than the others do. Photos that two collections both find all go, with the photos taken meanwhile, to the one whose descriptions fit them better, so that one occasion is offered once, in one collection; the other collection's visit is offered with the photos it kept, if it still has enough. Photos that surely belong to another collection (a dish among the photos of a garden) are left out of a collection's visits, and photos of a visit named in one collection, or taken during it and fitting it better, are never offered to another. At most 3 visits are notified per night, the newest first, and the others wait for the next night. Each visit is notified once: dismissing or deleting the notification never brings it back.

The notifications are on by default. Administrators turn them off for everyone in **Administration > Settings > Collections**, where they can also change the number per night and the days of uploads looked at, and look for new visits now with **Look for new collections to name** under **Administration > Jobs > Create job**. Turn them off for yourself under **Account Settings > Features > New collection found notifications**.

## Tags

The tags added to copies make them easy to find, even if you haven't turned on the tags feature:

- **Explore** has a **Tags** row, with the newest photo of each tag as its cover. Select a tag to search for its photos, or **View all** to open the Tags page.
- The sidebar shows **Tags** with a tree of your tags, such as `Edits` → `Cropped`.
- The **Tags** filter in search lets you filter by tag.

See [Tags](/features/tags) for more.

## Setup

The assistant needs an ACP agent in the server container, logged in to its provider. Then you turn it on in the settings.

### Docker

The published images don't include the agents. Build the server image from this repository with `docker/docker-compose.assistant.yml`, which uses the `server-agents` target of `server/Dockerfile`:

1. In the `docker` folder of the repository, create `.env` from `example.env` if you haven't, and build and start Gallery with the override:

   ```bash
   docker compose -f docker-compose.yml -f docker-compose.assistant.yml up -d --build
   ```

   The override also works on top of `docker-compose.rootless.yml` and `docker-compose.prod.yml`. Use `--build` again after updating the repository. For development, use `docker-compose.dev.assistant.yml` on top of `docker-compose.dev.yml` in the same way.

2. Log in to the agents you want to use, or give them an API key. A login uses your subscription; an API key is billed per use.
   - **Claude Code** with a Claude subscription: run `docker exec -it immich_server claude`, type `/login`, open the link in your browser and paste the code back, then `/exit`. With an API key instead, set `ANTHROPIC_API_KEY` in `.env` and run the `up -d` command again.
   - **Codex** with a ChatGPT subscription: run `docker exec -it immich_server codex login --device-auth`, open the link and enter the code. With an API key instead, set `OPENAI_API_KEY` in `.env`, run the `up -d` command again, then `docker exec immich_server sh -c 'printenv OPENAI_API_KEY | codex login --with-api-key'`.

   `docker exec` runs as the user of the server (`1000:1000` with `docker-compose.rootless.yml`), so the login is saved where the agents look for it.

3. Check the container:

   ```bash
   docker exec immich_server immich-check-assistant
   ```

   It checks the agents (`claude-agent-acp --version`, `codex-acp --version`), the agent home, the logins, the fonts of the photo books and `ffmpeg`, and lists what's missing.

4. Turn the assistant on in the settings, as below.

The `server-agents` image adds:

| What                                                                 | Why                                                                                                                                                 |
| -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `claude-agent-acp`, with the Claude Code binary it comes with        | The `claude` profile. `claude` runs the same Claude Code, for logging in.                                                                           |
| `codex-acp` and `codex`                                              | The `codex` profile, and the Codex CLI for logging in. Codex can generate images, so it can be the **Art profile**.                                 |
| The agent home, `/var/lib/immich-agents`, on the `agent-home` volume | `HOME` of the server, of `docker exec` and so of the agents: their logins and settings (`~/.claude`, `~/.claude.json`, `~/.codex`) survive updates. |

The agents are installed in `/opt/immich-agents`, at the versions pinned in `docker/scripts/install-agents.sh`, and add about 650 MB to the image. Every image built from `server/Dockerfile` also has the fonts that photo books are drawn with (Liberation and GNU FreeFont); the image already has the `ffmpeg` that highlight videos use.

:::note Agents in the server container
The agents run as processes inside the Gallery server container, for now. They see its filesystem with the permissions of the server, including the library in `/data`. What limits them is the [scrubbed environment and the tool checks](#security-and-privacy): they get no database or Gallery secrets, start in an empty directory, and can only use Gallery's tools, which ask for approval before changing the library. Running the agents in a separate container is a future hardening.
:::

### Other installations

Install an ACP agent adapter where the server runs, for example `npm install -g @agentclientprotocol/claude-agent-acp @agentclientprotocol/codex-acp`, so that its command is on the server's `PATH`. Log in as the user the server runs as (`claude-agent-acp --cli` runs Claude Code, and codex-acp installs `codex`), or give the server an API key such as `ANTHROPIC_API_KEY` or `OPENAI_API_KEY`: the default profiles forward these variables to the agent. For photo books, install the Liberation fonts (`fonts-liberation` on Debian and Ubuntu).

### Settings in Gallery

1. In **Administration > Settings > AI Assistant**:
   - turn on **Enable AI assistant**;
   - check the **Agent profiles** (command, arguments, environment variables and forwarded server variables);
   - choose the **Chat profile** and, optionally, the **Art profile** (for example `codex`) to enable artistic styles and illustrated maps.
2. Optionally, in **Administration > Settings > Photo books**, add a **Stadia Maps API key** for the watercolor, toner and terrain map styles. Styled maps need no key: they use the map of **Administration > Settings > Map**.
3. Optionally, in **Administration > Settings > Food**, turn on **Look up restaurants on OpenStreetMap** (see [Restaurant names](#restaurant-names)).

### Settings

| Setting                                | Default                                              | Description                                                                                                                                                                                                                                              |
| -------------------------------------- | ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `agent.enabled`                        | `false`                                              | **Enable AI assistant**.                                                                                                                                                                                                                                 |
| `agent.profiles`                       | `claude` (`claude-agent-acp`), `codex` (`codex-acp`) | **Agent profiles**: the ACP agents Gallery can start. Each has a `name`, a `command`, `args`, `env` (variables set on the agent process) and `passEnv` (names of server environment variables to forward).                                               |
| `agent.chatProfile`                    | `claude`                                             | **Chat profile** used for assistant chats.                                                                                                                                                                                                               |
| `agent.artProfile`                     | _(empty)_                                            | **Art profile** used for artistic styles and illustrated maps. It must be an agent that can generate images. Empty disables artistic styles.                                                                                                             |
| `agent.maxConcurrentSessions`          | `3`                                                  | **Maximum concurrent sessions**: agent processes running at once. Idle chats are stopped to make room; new chats are rejected when all are busy. Art jobs are also limited to this number.                                                               |
| `agent.idleTimeoutMinutes`             | `15`                                                 | **Idle timeout (minutes)**: an idle agent process is stopped after this time. The chat is kept and continues on your next message.                                                                                                                       |
| `agent.autoApproveWrites`              | `false`                                              | **Auto-approve changes**: lets the agent change the library of every user without asking for approval.                                                                                                                                                   |
| `agent.activityRetentionDays`          | `90`                                                 | **Activity log retention (days)**: how long changes stay in the activity log, where they can be undone (see [Undoing the assistant's changes](#undoing-the-assistants-changes)).                                                                         |
| `agent.mcpUrl`                         | _(empty)_                                            | **MCP URL** the agent uses to reach Gallery's tools. Empty uses `http://127.0.0.1:<port>/api/agent/mcp`.                                                                                                                                                 |
| `books.maps.stadiaApiKey`              | _(empty)_                                            | **Stadia Maps API key** for the watercolor, toner and terrain map styles. Not needed for styled and sketch maps.                                                                                                                                         |
| `books.maps.defaultStyle`              | `styled`                                             | **Default map style** used when a book's map style is **Auto**: `styled`, `sketch`, `watercolor`, `toner` or `terrain`. Styled maps use the map data of the Map page (`map.enabled`, `map.lightStyle`).                                                  |
| `books.drafts.enabled`                 | `true`                                               | **Suggested books**: draft books for the users with the nightly tasks, for them to keep or discard (see [Suggested books](#suggested-books)). Users can turn it off in their settings.                                                                   |
| `books.drafts.maxPerRun`               | `3`                                                  | **Books per night**: the most books drafted for a user per run.                                                                                                                                                                                          |
| `books.drafts.yearly`                  | `true`                                               | **Yearly collection books**, e.g. "2026 in food".                                                                                                                                                                                                        |
| `books.drafts.trips`                   | `true`                                               | **Trip books**.                                                                                                                                                                                                                                          |
| `books.drafts.birthdays`               | `true`                                               | **Birthday books**.                                                                                                                                                                                                                                      |
| `collections.notifications.enabled`    | `false`                                              | **New collection found notifications**: notify the users of new visits of the collections to name, with the nightly tasks (see [New collection found](#new-collection-found)). Off by default for now. Users can turn it off in their settings.          |
| `collections.notifications.maxPerRun`  | `3`                                                  | **Notifications per night**: the most notifications sent to a user per run.                                                                                                                                                                              |
| `collections.notifications.windowDays` | `14`                                                 | **Days of uploads**: only photos uploaded in this many days are looked at.                                                                                                                                                                               |
| `food.openStreetMap.enabled`           | `false`                                              | **Look up restaurants on OpenStreetMap**: lets the assistant look up the restaurants near a meal when their name can't be read on the photos. It sends the location of the meal to the Overpass API, only when the assistant asks and the user approves. |
| `food.openStreetMap.overpassUrl`       | `https://overpass-api.de/api/interpreter`            | **Overpass API URL**: the Overpass API interpreter that is asked for the restaurants near a meal.                                                                                                                                                        |

The default `claude` profile forwards `ANTHROPIC_API_KEY` and `CLAUDE_CODE_EXECUTABLE`, and the `codex` profile forwards `OPENAI_API_KEY` and `CODEX_PATH`.

## Security and privacy

- **Scrubbed environment.** An agent process doesn't inherit the server environment. It only gets `PATH`, `HOME`, `LANG` and `TZ`, the variables named in its profile's forwarded server variables, and the variables set in the profile. Variables starting with `DB_`, `REDIS_`, `IMMICH_`, `TYPESENSE_` or `MACHINE_LEARNING_` are never forwarded, even when configured.
- **Empty working directory.** Each agent starts in its own empty, private temporary directory, which is removed when it stops. Gallery gives it no access to files or a terminal.
- **Per-session token.** Each running chat gets its own random token for Gallery's tools. It is only kept in memory, and revoked when the agent stops. Tool calls run with the permissions of the user who is chatting.
- **Only Gallery tools.** Gallery rejects any tool that isn't a Gallery tool, such as the shell, files or the web. For Claude Code, the built-in tools are also removed, and the host user's settings, hooks and MCP servers are ignored.
- **Restricted art agent.** The art agent gets no Gallery tools. It may only generate images and write files inside its own working directory; everything else is rejected.
- **Cloud providers.** With a cloud model, photo previews, metadata and the names of people are sent to the provider. Artistic styles and illustrated maps send the photo or the map to the art agent's provider. Only configure agents you trust.
- **OpenStreetMap.** The [restaurant lookup](#restaurant-names) is off by default. When it's on, the location of a meal is sent to the Overpass API only when the assistant asks and the user approves.

## Troubleshooting

- **The agent isn't found.** The chat shows an error such as `Agent claude exited during initialization`, with `ENOENT` in the message. Check that the profile's **Command** is installed in the server container and on its `PATH`. With Docker, the image must be built with `docker-compose.assistant.yml` (see [Docker](#docker)); `docker exec immich_server immich-check-assistant` shows what's missing.
- **The agent isn't logged in.** The chat shows an authentication error, such as _Please run /login_. Log in again as in [Docker](#docker), or check the API key in `.env`. Logins are kept on the `agent-home` volume; they're lost if it's removed, for example with `docker compose down -v`.
- **No image is generated.** The error _The art agent did not produce an image_ means the art profile's agent can't generate images. Choose an agent with image generation, such as Codex, as the **Art profile**.
- **Maps are drawn as sketches.** Styled maps need the map to be turned on in **Administration > Settings > Map**, and the server must reach its tile server (by default `tiles.immich.cloud`). The watercolor, toner and terrain styles need a Stadia Maps API key, and fall back to the sketch when the tiles can't be downloaded. The review shows **Map style not available**. A custom map style whose tiles are served as a single PMTiles file, or only as raster images, can't be used for styled maps.
- **The menu isn't read.** The dialog says _No items could be read on the menu_, or the assistant finds few items. The menu may be blurry, tilted, in a strong perspective, too dark or partly covered. Photograph the menu straight on, flat and in focus, in several parts for a long menu. You can still name the dishes by hand, or **Ask the assistant**: it looks at the menu photos itself, reads the items, and matches the dishes with what it read.
- **A highlight video fails.** The notification says why. Videos are rendered with the `ffmpeg` that Gallery uses to transcode videos; when the server runs outside Docker, `ffmpeg` and `ffprobe` must be installed, or their paths set with `FFMPEG_PATH` and `FFPROBE_PATH`. Photos smaller than about 1000 pixels are left out, as they would look blurry in 1080p.
- **A photo isn't enhanced.** _This photo already looks good, there is nothing to enhance at this strength._ Auto-enhance only applies corrections a photo needs. Try the **Strong** strength, or leave the photo as it is.
