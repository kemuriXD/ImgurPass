# ImgurPass: before and after

The same real Imgur links, opened from the UK (where Imgur is blocked) in Chromium without ImgurPass and then with it. "After" uses ImgurPass 0.1.0 with its default settings plus access to all sites, so embeds on other sites are fixed too.

Screenshots are 1280×800 and live in [`comparison/`](comparison).

## Direct image link

`https://i.imgur.com/dqxZm2Y.jpeg`

| Before | After |
| --- | --- |
| ![Imgur's "Content not viewable in your region" placeholder](comparison/direct-image-before.jpg) | ![The real image, loaded through the DuckDuckGo image proxy](comparison/direct-image-after.jpg) |
| Imgur swaps the image for its "Content not viewable in your region" placeholder. | The real image, through the DuckDuckGo image proxy. |

## Album

`https://imgur.com/a/tUlsG`

| Before | After |
| --- | --- |
| ![Imgur's "Content Not Available" page](comparison/album-before.jpg) | ![The album in the ImgurPass viewer](comparison/album-after.jpg) |
| Imgur's "Content Not Available" page. | All 19 items in the ImgurPass viewer, read from the ImgurPass server. Click an image to see it full size. |

## Gallery post

`https://imgur.com/gallery/whole-load-of-nope-ZjVrcOE`

| Before | After |
| --- | --- |
| ![Imgur's "Content Not Available" page](comparison/gallery-before.jpg) | ![The gallery post in the viewer](comparison/gallery-after.jpg) |
| Imgur's "Content Not Available" page. | The post (a short video) in the viewer, with its title. |

## Single post (video)

`https://imgur.com/5fhqpd2`

| Before | After |
| --- | --- |
| ![Imgur's "Content Not Available" page](comparison/post-before.jpg) | ![The video post in the viewer with player controls](comparison/post-after.jpg) |
| Imgur's "Content Not Available" page. | The post in the viewer. Videos in posts and albums get the browser's player: play, seek, volume and fullscreen. |

## Video link

`https://i.imgur.com/tfgwzwf.gifv`

| Before | After |
| --- | --- |
| ![Imgur's "Content Not Available" page](comparison/video-before.jpg) | ![The video playing in the viewer](comparison/video-after.jpg) |
| Imgur's "Content Not Available" page. | The video playing in the viewer, through the ImgurPass server. |

## Deleted post

`https://imgur.com/4t4yzHk`

| Before | After |
| --- | --- |
| ![Imgur's "Content Not Available" page](comparison/deleted-post-before.jpg) | ![The viewer saying the post was not found](comparison/deleted-post-after.jpg) |
| Imgur's "Content Not Available" page, which hides that the post is gone. | The viewer says plainly that the post doesn't exist any more. |

## Images embedded on a forum

[BunsenLabs forum thread](https://forums.bunsenlabs.org/viewtopic.php?pid=1545)

| Before | After |
| --- | --- |
| ![Forum post where every Imgur image is the region placeholder](comparison/forum-before.jpg) | ![The same forum post with its screenshots showing](comparison/forum-after.jpg) |
| Every embedded Imgur image is the region placeholder. | The real screenshots, through the DuckDuckGo image proxy. |

The toolbar button on that page:

![ImgurPass popup: 8 images unblocked on this page](comparison/popup-after.jpg)

## Embeds on any page: images, videos and albums

A plain test page that embeds real Imgur media: an image, a thumbnail, a `<video>` (twice, with `src` and with `<source>`), an album `<iframe>`, and Imgur's own embed code (a blockquote plus a script from `s.imgur.com`).

| Before | After |
| --- | --- |
| ![Test page with broken images and empty video boxes](comparison/test-page-before.jpg) | ![Test page with the images and videos showing](comparison/test-page-after.jpg) |
| Images and videos don't load at all. | Images load through DuckDuckGo, videos through the ImgurPass server. |
| ![Album iframe showing an error, Imgur's embed code left as a bare link](comparison/test-page-albums-before.jpg) | ![Both album embeds showing the album in the viewer](comparison/test-page-albums-after.jpg) |
| The album iframe fails, and Imgur's embed code stays a bare link because its script can't load. | Both become the ImgurPass viewer, showing the album in place. |
