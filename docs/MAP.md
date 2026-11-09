# Map

The **Map** plugin shows the rows of a database as pins on a map (OpenStreetMap), from their coordinates. Keep a list
of places you'd like to visit, in France and elsewhere, and when you travel, see at a glance what is worth a detour
near you or near the town you're going to.

The places are rows of an ordinary Nootion database: filter, sort, group or export them like any other database,
write notes and paste photos in each place's page, and share them like any other page.

## Turning it on

An administrator turns on **Map** in **Administration › Plugins**. There is nothing else to set up: by default the map
uses OpenStreetMap's tiles and its Nominatim server to search addresses, both free for light use.

## The block

In a page, type `/map` (or `/carte`), then:

- **Create a "Places to visit" database here**: a database is added under the page, with a **Status** (To see / Seen),
  a **Place** (the coordinates), an **Address** and a **Country** for each place, and the usual **Tags** to sort
  places by kind (museum, nature, restaurant…);
- or **show a database that already has coordinates**: a column of the **Place** type, two number columns named
  **Latitude** and **Longitude**, or a text column named like *Coordinates* or *GPS* holding `48.85837, 2.29448`.

The block then shows:

- **the map**, a pin per place, coloured by its status (the colours of the **Status** options). A click on a pin shows
  its name, address, status, a link to its page, **Directions** (opens Google Maps, or its app on a phone) and
  **Move the pin**;
- **the search**: type a place of the list, an address, a town or a monument. Places of the list come first; a found
  address moves the map there and offers to add it to the list. Coordinates and Google Maps or OpenStreetMap links can
  be pasted too;
- **Near me**: the map goes to where you are (the browser asks first; Nootion must be opened over **https**);
- **Add a place**: click on the map where the place is (or right-click, or press long on a phone, without the
  button). Nootion looks up what is there to name it; change the name if needed, pick the status, then
  **Add to the list**. The pin can be dragged to adjust it first;
- **the nearest places**, to your position once located, otherwise to the middle of the map, within 5 to 300 km or
  anywhere. To see what is near a town you're going to, search the town: the list follows the map;
- the chips **All / To see / Seen** to show only some statuses, **⤢** to show every place, and **⛶** for full screen.

People who can only read the database see the map and the places, but can't add or move them.

## The "Place" column

**Place** is a column type of its own: its cells keep coordinates as text (`48.85837, 2.29448`), which reads well
in a CSV export and in filters. Click a cell to search an address, use your position, or type or paste coordinates
(a Google Maps link works). In a read-only cell, the coordinates open the place on OpenStreetMap.

## Settings

| Setting | Use |
|---|---|
| **Map tiles** | Address of the map's images, with `{z}`, `{x}` and `{y}`. By default `https://tile.openstreetmap.org/{z}/{x}/{y}.png`. Any other provider (with your key in the address if it needs one) works the same way. |
| **Map credit** | The credit shown in a corner of the map, which most providers require. Empty: OpenStreetMap's. |
| **Address search (Nominatim)** | A Nominatim server, by default `https://nominatim.openstreetmap.org`. Nootion calls it from the server, at most once a second (its rule), and remembers the answers for a day. |
| **Contact email for the address search** | Optional: sent with each search, as Nominatim's rules ask heavy users, so they can reach you. |

The browser loads the tiles straight from their provider; addresses are searched through Nootion. If your server
can't reach the Internet, the search won't work, but the map does as long as the browser reaches the tiles.

The map is drawn with [Leaflet](https://leafletjs.com) (BSD 2-Clause license), shipped with the plugin.
