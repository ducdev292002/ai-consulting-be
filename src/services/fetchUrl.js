async function fetchHtml(url) {
  let res;
  try {
    res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; AISalesBot/1.0)" },
      redirect: "follow",
      signal: AbortSignal.timeout(15000),
    });
  } catch (err) {
    throw Object.assign(new Error(`Không tải được URL: ${err.message}`), { status: 400 });
  }

  if (!res.ok) {
    throw Object.assign(new Error(`URL trả về HTTP ${res.status}`), { status: 400 });
  }

  const contentType = res.headers.get("content-type") || "";
  if (!contentType.includes("text/html")) {
    throw Object.assign(new Error(`Không phải trang HTML (content-type: ${contentType})`), { status: 400 });
  }

  return res.text();
}

function decodeEntities(str) {
  return str
    .replace(/&nbsp;/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&#0*39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function htmlToText(html, fallbackTitle) {
  const rawTitle = html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]?.trim();
  const title = rawTitle ? decodeEntities(rawTitle) : fallbackTitle;

  // Bỏ menu điều hướng / header / footer / sidebar — các khối này lặp lại y hệt
  // trên mọi trang của 1 website, nếu giữ lại sẽ làm nhiễu tri thức thật của từng trang.
  const text = decodeEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<nav[\s\S]*?<\/nav>/gi, " ")
      .replace(/<header[\s\S]*?<\/header>/gi, " ")
      .replace(/<footer[\s\S]*?<\/footer>/gi, " ")
      .replace(/<aside[\s\S]*?<\/aside>/gi, " ")
      .replace(/<[^>]+>/g, " ")
  )
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n\s*\n+/g, "\n\n")
    .trim();

  return { title, text };
}

function extractLinks(html, baseUrl) {
  const base = new URL(baseUrl);
  const links = new Set();

  for (const match of html.matchAll(/<a\s[^>]*href=["']([^"'#]+)["']/gi)) {
    let href = match[1].trim();
    if (!href || href.startsWith("mailto:") || href.startsWith("tel:") || href.startsWith("javascript:")) {
      continue;
    }

    let absolute;
    try {
      absolute = new URL(href, base);
    } catch {
      continue;
    }

    if (absolute.hostname !== base.hostname) continue;
    if (/\.(pdf|jpg|jpeg|png|gif|svg|webp|zip|rar|docx?|xlsx?|css|js|ico|mp4|mp3)$/i.test(absolute.pathname)) {
      continue;
    }

    absolute.hash = "";
    links.add(absolute.toString());
  }

  return [...links];
}

export async function fetchUrlAsText(url) {
  const html = await fetchHtml(url);
  const { title, text } = htmlToText(html, url);

  if (!text) {
    throw Object.assign(new Error("Trang không có nội dung văn bản trích xuất được"), { status: 400 });
  }

  return { title, text };
}

export { fetchHtml, htmlToText, extractLinks };
