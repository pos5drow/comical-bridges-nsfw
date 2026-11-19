# Comments: source survey

Surveyed 2026-11-15, read-only: no logins, posts or votes. This file records structure only, no
content. The design is in comical's `docs/comments-plan.md`. V = verified live, S = from the site's
JS or a third-party client, I = inferred.

**No site comments per page.** A gallery thread is the series scope. Kemono and Pawchive comments hang
off a post (= chapter).

| Bridge | Scope | Read endpoint | Threading | Votes | Write needs | Notes |
|---|---|---|---|---|---|---|
| e-hentai | gallery | gallery HTML `#cdiv` (`div.c1`…`c6#comment_{id}`), `?hc=1` shows all (V) | flat | score, breakdown visible | forum cookies, **which the bridge already holds** (web-login) | first write target; vote via `api.php` `votecomment` (I) |
| nhentai | gallery | `GET /api/v2/galleries/{id}/comments?page&per_page` (V); `?include=comments` adds `comment_count` | flat | none | `User` token + proof-of-work + CAPTCHA, rate-limited | **read-only**: we don't automate CAPTCHAs |
| kemono, pawchive | post | `GET /api/v1/{svc}/user/{uid}/post/{pid}/comments` (V); gzip; no count field | `parent_id` | none | none: mirrored from the original platform | read-only by nature |
| hentai2read | series | Inertia partial reload of the series URL, `X-Inertia-Partial-Data: comments` (V); `commentCount` comes free in page props | 1 level | like/dislike | account | |
| hentaifox | gallery | `POST /includes/comments.php {gallery_id}` JSON (S) | nested `parent` | like/dislike | account (Turnstile on page) | |
| imhentai | gallery | `POST /inc/comments.php` JSON (S) | nested `parent` | none | account | same script family as hentaifox |
| wnacg | album | `/?ctl=comment&act=frag&aid&sort=hot\|new&page` HTML, 10/page (V) | 1 level | up/down | account + slider captcha, may be held for review | likely read-only |
| jmcomic | album (comments link to a chapter) | `POST /ajax/album_pagination` (S); CF-walled for an honest UA | nested | likes (mobile API only) | account | blocked until the wall is passed in-app |
| myreadingmanga | post | WordPress, CF-walled (I) | nested (I) | none | ? | walled |
| hitomi, schalenetwork, hdoujin | **none** | – | – | – | – | – |
