import { fetchHtml, htmlToText, extractLinks } from "./fetchUrl.js";

const MAX_PAGES_HARD_CAP = 30;

function normalizeUrl(url) {
  const u = new URL(url);
  u.hash = "";
  if (u.pathname !== "/" && u.pathname.endsWith("/")) u.pathname = u.pathname.slice(0, -1);
  return u.toString();
}

// Menu/header/footer thường không nằm trong thẻ semantic <nav>/<header> mà chỉ là
// <div> thường, nên không lọc được theo cấu trúc HTML. Cách tổng quát hơn: dòng nào
// xuất hiện GIỐNG HỆT ở phần lớn các trang vừa quét chắc chắn là phần khung lặp lại
// (menu, footer, thanh liên hệ...), không phải nội dung riêng của từng trang — loại bỏ.
function stripBoilerplate(pages) {
  if (pages.length < 3) return pages; // không đủ dữ liệu để so sánh chéo đáng tin cậy

  const lineCount = new Map();
  for (const page of pages) {
    const uniqueLines = new Set(
      page.text
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean)
    );
    for (const line of uniqueLines) {
      lineCount.set(line, (lineCount.get(line) || 0) + 1);
    }
  }

  const threshold = Math.ceil(pages.length * 0.6);
  const boilerplateLines = new Set(
    [...lineCount.entries()].filter(([, count]) => count >= threshold).map(([line]) => line)
  );

  if (boilerplateLines.size === 0) return pages;

  return pages.map((page) => {
    const cleaned = page.text
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l && !boilerplateLines.has(l))
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    return { ...page, text: cleaned || page.text };
  });
}

export async function crawlWebsite({ startUrl, maxPages = 15, onPage }) {
  const cap = Math.min(Math.max(1, maxPages), MAX_PAGES_HARD_CAP);

  const start = normalizeUrl(startUrl);
  const visited = new Set();
  const queue = [start];
  const pages = [];
  const errors = [];

  while (queue.length > 0 && pages.length < cap) {
    const url = queue.shift();
    if (visited.has(url)) continue;
    visited.add(url);

    try {
      const html = await fetchHtml(url);
      const { title, text } = htmlToText(html, url);

      if (text && text.length > 40) {
        pages.push({ url, title, text });
        onPage?.({ url, title, ok: true });
      } else {
        errors.push({ url, error: "Trang không có đủ nội dung văn bản" });
        onPage?.({ url, ok: false, error: "Nội dung quá ngắn" });
      }

      if (pages.length < cap) {
        for (const link of extractLinks(html, url)) {
          const normalized = normalizeUrl(link);
          if (!visited.has(normalized) && !queue.includes(normalized)) {
            queue.push(normalized);
          }
        }
      }
    } catch (err) {
      errors.push({ url, error: err.message });
      onPage?.({ url, ok: false, error: err.message });
    }
  }

  return { pages: stripBoilerplate(pages), errors, totalDiscovered: visited.size };
}
