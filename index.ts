import puppeteer from "puppeteer";
import fs from "fs";
import sizeOf from "buffer-image-size";

const whatElementScript = fs.readFileSync(
  "./whatsElement.js",
  "utf8"
);

const url = "https://fund.eastmoney.com/";
// const url = "https://www.qcc.com/area/hun_430900";
// const url = "http://www.gov.cn/hudong/2020-07/09/content_5525332.htm";
const fileName = url.replace(/[/.:]/g, "");

const main = async () => {
  try {
    fs.unlinkSync(`${fileName}.json`);
  } catch (e) {}

  const browser = await puppeteer.launch({
    headless: true,
    // slowMo: 1000,
    args: ["--window-position=0,0"],
    devtools: true,
  });

  const page = await browser.newPage();
  await page.goto(url);
  await page.waitForTimeout(10000);

  await page.screenshot({
    path: `${fileName}.png`,
    fullPage: true,
    captureBeyondViewport: true,
  });

  const dimensions = sizeOf(fs.readFileSync(`${fileName}.png`));
  const html_width = dimensions.width;
  const html_height = dimensions.height;

  if (html_width === 0 || html_height === 0) {
    await browser.close();
    console.error("error: get html boundingBox");
    return;
  }

  console.log("html boundingBox", { html_width, html_height });

  await page.setViewport({ width: html_width, height: html_height });
  await page.reload();
  await page.waitForTimeout(1000);
  await page.screenshot({
    path: `${fileName}.png`,
    fullPage: true,
    captureBeyondViewport: true,
  });

  const gap = 1000;
  const count = Math.floor(html_height / gap);
  const results = await Promise.all((new Array(count + 1).fill(0).map((_, idx) => {
    const increment = idx === count ? html_height % gap : gap;

    // 防止 IP 被封，增加延迟
    return page.waitForTimeout(10000 * idx).then(() => {
      return createPage(browser, html_width, html_height, url, gap * idx, gap * idx + increment)
    });
  })));
  // const result = await createPage(
  //   browser,
  //   html_width,
  //   html_height,
  //   url,
  //   4500,
  //   4700
  // );
  // const results = [result];

  const result_json = JSON.stringify(results.flat());
  fs.writeFileSync(`${fileName}.json`, result_json);

  await browser.close();
};

const createPage = async (
  browser: puppeteer.Browser,
  w: number,
  h: number,
  url: string,
  start: number,
  end: number
) => {
  const page = await browser.newPage();
  await page.goto(url);
  await page.waitForTimeout(10000);

  await page.setViewport({ width: w, height: h });

  await page.waitForTimeout(10000);

  await page.addScriptTag({
    content: whatElementScript,
  });

  // 等待 whats-element 加载完成
  await page.waitForTimeout(3000);

  // 删除display:none的元素，防止 hover 显示
  await page.evaluate(() => {
    const removeElement = (element: Element) => {
      const style = getComputedStyle(element);

      if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") {
        element.parentNode?.removeChild(element);
      }

      if (element.children.length > 0) {
        for (let i = 0; i < element.children.length; i++) {
          if (element.children[i]) {
            removeElement(element.children[i]);
          }
        }
      }
    };

    removeElement(document.body);
  });

  await page.evaluate(() => {
    // @ts-ignore
    const whats = new window.whatsElement({ draw: false });

    // 滚动条会导致定位出现偏移
    document.body.style.overflow = "hidden";

    document.body.addEventListener(
      "mouseover",
      (event) => {
        if (event.target) {
          const target = event.target as HTMLElement;

          event.preventDefault();
          event.stopPropagation();
          event.stopImmediatePropagation();

          if (target.tagName.toLowerCase() === "body") {
            return;
          }

          const result = whats.getUniqueId(target);

          if (target.getAttribute("data-whats-element-wid") === null) {
            target.setAttribute("data-whats-element-wid", result.wid);
            target.setAttribute("data-whats-element-type", result.type);

            const boundingBox = target.getBoundingClientRect();
            result.width = boundingBox.width;
            result.height = boundingBox.height;

            target.style.color = "red";

            // 过滤掉干扰元素， 比如 a > img, 那么 a 元素可以忽略
            if (target.children.length === 0) {
              // @ts-ignore
              window.__whats_element_result
                ? // @ts-ignore
                  window.__whats_element_result.push(result)
                : // @ts-ignore
                  (window.__whats_element_result = [result]);
            }

            // const display = getComputedStyle(target).display;
            // if (display === "block" || display === "table-cell") {
              const nodeList = target.childNodes;
              for (let k = 0; k < nodeList.length; k++) {
                const node = nodeList[k];

                // 文字节点增加 span 标签
                if (node.nodeType === 3 && node.textContent?.trim() !== "") {
                  const text = node.textContent;
                  const textElement = document.createElement("span");
                  textElement.className = `span${k}`;
                  textElement.textContent = text ?? "";
                  textElement.style.display = "inline";
                  textElement.style.float = "none";
                  textElement.style.padding = "0";
                  textElement.style.margin = "0";
                  textElement.style.lineHeight = "inherit";
                  textElement.style.fontWeight = "inherit";
                  textElement.style.fontSize = "inherit";

                  textElement.setAttribute(
                    "data-whats-element-wid",
                    `${result.wid}>.${textElement.className}`
                  );
                  textElement.setAttribute(
                    "data-whats-element-type",
                    result.type
                  );

                  node.replaceWith(textElement);

                  const boundingBox = textElement.getBoundingClientRect();

                  // @ts-ignore
                  window.__whats_element_result.push({
                    ...result,
                    wid: `${result.wid}>.${textElement.className}`,
                    width: boundingBox.width,
                    height: boundingBox.height,
                    left: boundingBox.left,
                    top: boundingBox.top,
                  });
                }
              }
            // }
          }
        }
      },
      true
    );
  });

  for (let x = 0; x <= w; x += 15) {
    for (let y = start; y <= end; y += 5) {
      await page.mouse.move(x, y);
    }
  }

  const result =
    (await page.evaluate(() => {
      // @ts-ignore
      return window.__whats_element_result;
    })) || [];

  console.log(result.length);
  if (result.length === 0) {
    console.error("get result error", start, end);
  }

  return result ?? [];
};

main();
