export async function fetchUrlAsText(url) {
  let res;
  try {
    res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; AISalesBot/1.0)" },
      redirect: "follow",
    });
  } catch (err) {
    throw Object.assign(new Error(`Không tải được URL: ${err.message}`), { status: 400 });
  }

  if (!res.ok) {
    throw Object.assign(new Error(`URL trả về HTTP ${res.status}`), { status: 400 });
  }

  const html = await res.text();

  const title = html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]?.trim() || url;

  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n\s*\n+/g, "\n\n")
    .trim();

  if (!text) {
    throw Object.assign(new Error("Trang không có nội dung văn bản trích xuất được"), { status: 400 });
  }

  return { title, text };
}
