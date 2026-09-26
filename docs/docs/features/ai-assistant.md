# AI Assistant (experimental)

The AI assistant lets you ask for things in plain language, such as _"Make an album of our summer holiday in Italy, about 150 photos, make sure both girls are in it, and crop the portraits to square"_ or _"Make a 20-page photo book of our Italy trip"_. It can also turn photos into artwork, such as a watercolor travel-journal page.

Immich doesn't include an AI model itself. It connects to an AI agent you already use, such as [Claude Code](https://www.anthropic.com/claude-code), [Codex](https://openai.com/codex), Gemini CLI or OpenCode, through the [Agent Client Protocol (ACP)](https://agentclientprotocol.com). The agent plans the work, and Immich gives it a set of photo tools over [MCP](https://modelcontextprotocol.io).

Some related features don't use AI at all: [auto-enhance and straightening](#auto-enhance-and-straighten) run locally on your server, photo books can be laid out, edited and exported without the assistant, and [naming the dishes](#food) of your meals uses the smart search and OCR models of your server.

:::caution Experimental
This feature is experimental and disabled by default. The agent runs as a process inside the Immich server container. When it uses a cloud model, the photos it looks at (previews, contact sheets and rendered book pages), their metadata and the names of people are sent to that provider.
:::

## The assistant

### What it can do

With its tools, the assistant can:

- understand your library: search by meaning and filters, find people, split a date range or album into events and trips, read metadata, and look at photos on a contact sheet;
- choose photos: group bursts and near-duplicates, score sharpness, exposure and faces, and pick a balanced selection (for example _"the 30 best photos of last year, no more than 2 per event"_);
- crop photos around faces, straighten tilted photos and enhance dull ones;
- create albums, and add or remove photos;
- design, review, edit and export [photo books](#photo-books);
- create [artistic versions](#artistic-styles) of photos;
- find the restaurant meals among your photos, read their menus and [name the dishes](#food);
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

Actions that ask for approval include creating an album, adding or removing photos, cropping, straightening, enhancing or improving photos, creating artwork, illustrating maps, exporting a book, and editing a book that wasn't created in the current chat. Books the assistant creates in the chat are drafts, so it edits them without asking. An unanswered request counts as declined after 10 minutes.

To skip the prompts, turn on **Auto-approve** at the top of a chat. It only applies to that chat. An administrator can also turn on **Auto-approve changes** in the settings, which skips approvals for every user.

### Stopping a run

Select **Stop** next to the message box to cancel the current run. Any pending approval is denied. You can send a new message afterwards.

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

### Picking photos on what they can become

When the assistant picks the best photos for an album or a book, it doesn't only look at the photos as they are. It also considers how they would look after the fixes Immich can make: straightening, a tighter crop and auto-enhance. These fixes are tried on small previews first, without creating anything. A slightly dark, color-cast, tilted or loosely framed photo of a great moment is no longer beaten by a clean but dull one. Blurry photos still lose, because blur can't be fixed.

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
- **Map style not available**: a map style that needs a Stadia Maps key, drawn as a sketch instead.
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

### Map pages

Map pages show the route, the stops, place names, a compass rose, a scale bar and the section title. Choose the **Map style** when you create or re-lay out a book:

- **Auto**: the default style chosen by your administrator.
- **Sketch (offline)**: drawn on your server. No locations are sent to a map provider.
- **Watercolor**, **Toner** and **Terrain**: the Stamen styles from [Stadia Maps](https://stadiamaps.com). They need a Stadia Maps API key in the admin settings.

:::info Map tiles and privacy
The watercolor, toner and terrain styles send the coordinates of the trip to Stadia Maps to download map tiles. Without an API key, or when the tiles can't be downloaded, all maps fall back to the offline sketch style.
:::

**Illustrate maps with AI** asks the [art agent](#artistic-styles) to paint over each map page as a hand-illustrated vintage watercolor travel map, keeping the geography, route, pins and place names. It needs an art profile and adds a few minutes per map. The rendered map is saved as a photo tagged `Photo books/Maps`, and the illustration is stacked with it.

## Artistic styles

Artistic styles are made by the **art agent**: an ACP agent whose model can generate images, such as Codex. An administrator chooses it as the **Art profile**. The art agent receives the preview of the photo and a prompt, and returns one image. It gets no Immich tools.

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
- **Editorial watercolor split**: image generation redraws a photo instead of keeping it. So the art agent only paints the watercolor half, and Immich places your untouched original photo above it.

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

## Food

Immich can find the restaurant meals among your photos, read the menus you photographed, and suggest which menu item each dish photo shows. You check the names, and Immich tags the photos by restaurant and dish. A **Food** photo book then lays them out like a printed menu.

It uses the smart search (CLIP) and OCR models of your server: nothing is sent anywhere, unless you ask the [assistant](#the-assistant) for help or turn on the [OpenStreetMap lookup](#restaurant-names). Without smart search, dishes can't be recognized, so **Name the dishes…** isn't shown.

### Name the dishes

Open an album and choose **Name the dishes…** from its menu, or select photos you own and choose **Name the dishes…** from the menu of the selection.

1. **Finding the meals.** Immich recognizes the photos of dishes and drinks, menus, restaurant signs and receipts, and groups them into meals by time and place. The dialog lists each meal with its **Breakfast**, **Lunch** or **Dinner** time, its place, the name of the restaurant and where the name comes from, and the other names read on the photos. Select a meal to name its dishes. When nothing is found, the dialog says _No food photos found in this album_.
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

## Travel documents

Photograph your boarding passes and tickets on a trip, and Immich matches the photos of the trip with its legs. Choose **Name the legs of a trip…** from the menu of an album or of selected photos, or ask the assistant. It uses the same smart search and OCR models as [Food](#food), locally.

- **Documents.** Boarding passes, bus, train, ferry and monorail tickets, park and museum tickets and fare receipts are read into legs: the mode, the carrier, the flight or train number, from → to, the date and time, the seat and the class, in English, Greek, Japanese and Chinese. What can't be read is said, such as a date printed vertically, a year that isn't printed or a time written over by hand.
- **Legs.** A leg runs from a little before its departure (the wait at the station or the airport) until the next leg, or the end of its day; the photos between two legs belong to the destination of the earlier one. A document with only a date covers its day, one without a date the day it was photographed. The places and look a photo shares with a leg, such as a ferry's name on its hull, can move it to that leg. Days without documents stay unassigned: name them yourself, such as _Chania day_.
- **Tags.** Photos are tagged `Travel/<Trip>/<Leg>`, such as `Travel/Crete, October 2016/Bus Chania → Sougia, 4 Oct 2016`, and the documents `Travel/<Trip>/Tickets`. Name the trip after its destinations and month.
- **Travel books.** The **Travel** style is a travel journal: a chapter per leg, opened by a ticket stub typeset from the fields of its document, with a route line and a date stamp, then the photos of the leg. Review reports legs without photos, photos no document covers, documents without a date, and a page that prints a document itself.

:::info Travel documents and privacy
Travel documents carry names, booking references (PNRs), ticket and sequence numbers, frequent flyer and SSR codes, and barcodes that encode them. Immich reads only the fields of the journey, and hides everything else from every name it suggests, saves or prints: `PNR: A41NQS` becomes `PNR: •••`. The assistant never sees the documents, only these redacted fields: the tools that show it photos, contact sheets and book pages leave the documents out or blur them, whether they are tagged as tickets or only read as one. Ticket stubs replace the documents in books. The documents themselves stay in your library, unchanged.
:::

## Tags

The tags added to copies make them easy to find, even if you haven't turned on the tags feature:

- **Explore** has a **Tags** row, with the newest photo of each tag as its cover. Select a tag to search for its photos, or **View all** to open the Tags page.
- The sidebar shows **Tags** with a tree of your tags, such as `Edits` → `Cropped`.
- The **Tags** filter in search lets you filter by tag.

See [Tags](/features/tags) for more.

## Setup

1. Install an ACP agent adapter in the server container. For example, extend the image:

   ```dockerfile
   FROM ghcr.io/immich-app/immich-server:release
   RUN npm install -g @agentclientprotocol/claude-agent-acp @agentclientprotocol/codex-acp
   ```

2. Give the agent its credentials in the server environment, for example `ANTHROPIC_API_KEY` or `OPENAI_API_KEY`. The default profiles forward these variables to the agent.
3. In **Administration > Settings > AI Assistant**:
   - turn on **Enable AI assistant**;
   - check the **Agent profiles** (command, arguments, environment variables and forwarded server variables);
   - choose the **Chat profile** and, optionally, the **Art profile** (for example `codex`) to enable artistic styles and illustrated maps.
4. Optionally, in **Administration > Settings > Photo books**, add a **Stadia Maps API key** for the watercolor, toner and terrain map styles.
5. Optionally, in **Administration > Settings > Food**, turn on **Look up restaurants on OpenStreetMap** (see [Restaurant names](#restaurant-names)).

### Settings

| Setting                          | Default                                              | Description                                                                                                                                                                                                                                              |
| -------------------------------- | ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `agent.enabled`                  | `false`                                              | **Enable AI assistant**.                                                                                                                                                                                                                                 |
| `agent.profiles`                 | `claude` (`claude-agent-acp`), `codex` (`codex-acp`) | **Agent profiles**: the ACP agents Immich can start. Each has a `name`, a `command`, `args`, `env` (variables set on the agent process) and `passEnv` (names of server environment variables to forward).                                                |
| `agent.chatProfile`              | `claude`                                             | **Chat profile** used for assistant chats.                                                                                                                                                                                                               |
| `agent.artProfile`               | _(empty)_                                            | **Art profile** used for artistic styles and illustrated maps. It must be an agent that can generate images. Empty disables artistic styles.                                                                                                             |
| `agent.maxConcurrentSessions`    | `3`                                                  | **Maximum concurrent sessions**: agent processes running at once. Idle chats are stopped to make room; new chats are rejected when all are busy. Art jobs are also limited to this number.                                                               |
| `agent.idleTimeoutMinutes`       | `15`                                                 | **Idle timeout (minutes)**: an idle agent process is stopped after this time. The chat is kept and continues on your next message.                                                                                                                       |
| `agent.autoApproveWrites`        | `false`                                              | **Auto-approve changes**: lets the agent change the library of every user without asking for approval.                                                                                                                                                   |
| `agent.mcpUrl`                   | _(empty)_                                            | **MCP URL** the agent uses to reach Immich's tools. Empty uses `http://127.0.0.1:<port>/api/agent/mcp`.                                                                                                                                                  |
| `books.maps.stadiaApiKey`        | _(empty)_                                            | **Stadia Maps API key** for the watercolor, toner and terrain map styles. Empty draws every map as an offline sketch.                                                                                                                                    |
| `books.maps.defaultStyle`        | `watercolor`                                         | **Default map style** used when a book's map style is **Auto**: `sketch`, `watercolor`, `toner` or `terrain`. Without an API key, **Auto** uses the sketch style.                                                                                        |
| `food.openStreetMap.enabled`     | `false`                                              | **Look up restaurants on OpenStreetMap**: lets the assistant look up the restaurants near a meal when their name can't be read on the photos. It sends the location of the meal to the Overpass API, only when the assistant asks and the user approves. |
| `food.openStreetMap.overpassUrl` | `https://overpass-api.de/api/interpreter`            | **Overpass API URL**: the Overpass API interpreter that is asked for the restaurants near a meal.                                                                                                                                                        |

The default `claude` profile forwards `ANTHROPIC_API_KEY` and `CLAUDE_CODE_EXECUTABLE`, and the `codex` profile forwards `OPENAI_API_KEY` and `CODEX_PATH`.

## Security and privacy

- **Scrubbed environment.** An agent process doesn't inherit the server environment. It only gets `PATH`, `HOME`, `LANG` and `TZ`, the variables named in its profile's forwarded server variables, and the variables set in the profile. Variables starting with `DB_`, `REDIS_`, `IMMICH_`, `TYPESENSE_` or `MACHINE_LEARNING_` are never forwarded, even when configured.
- **Empty working directory.** Each agent starts in its own empty, private temporary directory, which is removed when it stops. Immich gives it no access to files or a terminal.
- **Per-session token.** Each running chat gets its own random token for Immich's tools. It is only kept in memory, and revoked when the agent stops. Tool calls run with the permissions of the user who is chatting.
- **Only Immich tools.** Immich rejects any tool that isn't an Immich tool, such as the shell, files or the web. For Claude Code, the built-in tools are also removed, and the host user's settings, hooks and MCP servers are ignored.
- **Restricted art agent.** The art agent gets no Immich tools. It may only generate images and write files inside its own working directory; everything else is rejected.
- **Cloud providers.** With a cloud model, photo previews, metadata and the names of people are sent to the provider. Artistic styles and illustrated maps send the photo or the map to the art agent's provider. Only configure agents you trust.
- **OpenStreetMap.** The [restaurant lookup](#restaurant-names) is off by default. When it's on, the location of a meal is sent to the Overpass API only when the assistant asks and the user approves.

## Troubleshooting

- **The agent isn't found.** The chat shows an error such as `Agent claude exited during initialization`, with `ENOENT` in the message. Check that the profile's **Command** is installed in the server container and on its `PATH`.
- **No image is generated.** The error _The art agent did not produce an image_ means the art profile's agent can't generate images. Choose an agent with image generation, such as Codex, as the **Art profile**.
- **Maps are drawn as sketches.** The watercolor, toner and terrain styles need a Stadia Maps API key, and fall back to the sketch when the tiles can't be downloaded. The review shows **Map style not available**.
- **The menu isn't read.** The dialog says _No items could be read on the menu_, or the assistant finds few items. The menu may be blurry, tilted, in a strong perspective, too dark or partly covered. Photograph the menu straight on, flat and in focus, in several parts for a long menu. You can still name the dishes by hand, or **Ask the assistant**: it looks at the menu photos itself, reads the items, and matches the dishes with what it read.
- **A photo isn't enhanced.** _This photo already looks good, there is nothing to enhance at this strength._ Auto-enhance only applies corrections a photo needs. Try the **Strong** strength, or leave the photo as it is.
