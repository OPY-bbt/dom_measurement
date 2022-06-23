import puppeteer, { Target } from "puppeteer";
import fs from "fs";
import sizeOf from "buffer-image-size";

const whatElementScript = fs.readFileSync("./whatsElement.js", "utf8");

const debug = false;

const url = "https://fund.eastmoney.com/";
// const url = "https://www.qcc.com/area/hun_430900";
// const url = "http://www.gov.cn/hudong/2020-07/09/content_5525332.htm";
// const url = "https://www.trip.com/travel-guide/";
// const url = "https://jn.meituan.com/";

const fileName = url.replace(/[/.:]/g, "");

const main = async () => {
  try {
    fs.unlinkSync(`${fileName}.json`);
    fs.unlinkSync(`${fileName}.png`);
  } catch (e) {}

  const browser = await puppeteer.launch({
    headless: !debug,
    // slowMo: 1000,
    args: ["--window-position=0,0", "--disable-web-security"],
    devtools: true,
  });

  const page = await browser.newPage();
  // 美团 302 重定向
  await page.goto(url);
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

  await removeInvisibleElement(page);

  const frameInfos = await page.evaluate(() => {
    const num = window.frames.length;
    const frames = document.body.querySelectorAll("iframe");

    return new Array(num).fill(0).map((_, idx) => {
      const frameWin = window.frames[idx];
      const boundingBox = frames[idx].getBoundingClientRect();

      return {
        url: frameWin.location.href,
        innerWidth: frameWin.innerWidth,
        innerHeight: frameWin.innerHeight,
        left: boundingBox.left,
        top: boundingBox.top,
        // @ts-ignore
        attributes: [...frames[idx].attributes].reduce(
          (s, n) => ({ ...s, [n.nodeName]: n.nodeValue }),
          {}
        ),
      };
    });
  });

  console.info("get iframe, the count is", frameInfos.length);

  let results = [];
  if (debug) {
    const result = await createPage(
      browser,
      {},
      html_width,
      html_height,
      url,
      4500,
      4600
    );
    results = [result];
  } else {
    const gap = 1000;
    const count = Math.floor(html_height / gap);

    const rootPagePromise = new Array(count + 1).fill(0).map((_, idx) => {
      const increment = idx === count ? html_height % gap : gap;

      // 防止 IP 被封，增加延迟
      return page.waitForTimeout(1000 * idx).then(() => {
        return createPage(
          browser,
          {},
          html_width,
          html_height,
          url,
          gap * idx,
          gap * idx + increment
        );
      });
    });

    const framePromise = frameInfos.map((_, idx) => {
      const frameInfo = frameInfos[idx];

      return page.waitForTimeout(10000).then(() => {
        return createPage(
          browser,
          frameInfo.attributes,
          frameInfo.innerWidth,
          frameInfo.innerHeight,
          frameInfo.url,
          0,
          frameInfo.innerHeight,
          frameInfo.left,
          frameInfo.top
        );
      });
    });

    results = await Promise.all([...rootPagePromise, ...framePromise]);
  }

  const result_json = JSON.stringify(results.flat());
  fs.writeFileSync(`${fileName}.json`, result_json);

  if (!debug) {
    await browser.close();
  }
};

const createPage = async (
  browser: puppeteer.Browser,
  payload: { [key: string]: string },
  w: number,
  h: number,
  url: string,
  start: number,
  end: number,
  dx: number = 0,
  dy: number = 0
) => {
  const page = await browser.newPage();
  await page.goto(url);
  await page.waitForTimeout(10000);

  await page.setViewport({ width: w, height: h });
  await page.reload();

  await page.waitForTimeout(10000);

  await page.addScriptTag({
    content: whatElementScript,
  });

  // 等待 whats-element 加载完成
  await page.waitForTimeout(3000);

  // 兼容 iframe 属性
  await page.evaluate((payload) => {
    document.body.setAttribute("marginwidth", payload.marginwidth);
    document.body.setAttribute("marginheight", payload.marginheight);
  }, payload);

  await removeInvisibleElement(page);

  await page.evaluate(() => {
    // @ts-ignore
    const whats = new window.whatsElement({ draw: false });

    // 滚动条会导致定位出现偏移
    document.body.style.overflow = "hidden";

    function commit(payload: any) {
      // @ts-ignore
      window.__whats_element_result
        ? // @ts-ignore
          window.__whats_element_result.push(payload)
        : // @ts-ignore
          (window.__whats_element_result = [payload]);
    }

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

            // TODO
            // 如果只有 textNode, 并且 textContent length 为 0， 忽略
            if (target.childNodes.length === 1) {
              const child = target.childNodes[0];
              if (
                child.nodeType === 3 &&
                child?.textContent?.trim().length === 0
              ) {
                return;
              }
            }

            // 过滤掉干扰元素， 比如 a > img, 那么 a 元素可以忽略
            // a > 只有 textNode, 那么 a 元素可以忽略
            // 自闭标签，如 <img />, <br />, <input />, <textarea />, <canvas /> 需要计算在内
            const totalTextNode = Array.from(target.childNodes).every(
              (v) => v.nodeType === 3
            );
            const hasBackgroundImage = getComputedStyle(target).backgroundImage !== "none";
            const isSelfCloseTag = [
              "img",
              "br",
              "input",
              "textarea",
              "canvas",
            ].includes(target.tagName.toLowerCase());

            if (
              target.children.length === 0 &&
              (!totalTextNode || isSelfCloseTag || hasBackgroundImage)
            ) {
              commit(result);
            }

            // 有些非自闭标签，也需要特殊处理
            if (["select"].includes(target.tagName.toLowerCase())) {
              commit(result);
            }

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

                const range = document.createRange();
                range.selectNodeContents(node);
                const boundingBox = range.getBoundingClientRect();
                const targetBoundingBox = { ...boundingBox };
                // const boundingBox = textElement.getBoundingClientRect();

                // 处理 横向 溢出换行文字溢出的情况
                const parentElementBoundingBox =
                  target.parentElement?.getBoundingClientRect() ?? {
                    width: Number.MAX_VALUE,
                    height: Number.MAX_VALUE,
                  };

                // const minw = Math.min(result.width, boundingBox.width, parentElementBoundingBox.width);
                const minh = Math.min(
                  result.height,
                  boundingBox.height,
                  parentElementBoundingBox.height
                );

                const clientRects = range.getClientRects();
                const firstClientRect = clientRects[0];

                const isRowTextNode = (node: Node): boolean => {
                  const range = document.createRange();

                  // @ts-ignore - nodeType === Node.textNode
                  const length = node.length;

                  if (length <= 1) {
                    return false;
                  }

                  range.setStart(node, 0);
                  range.setEnd(node, 1);
                  const firstCharY = range.getBoundingClientRect().top;

                  range.setStart(node, 1);
                  range.setEnd(node, 2);
                  const secondCharY = range.getBoundingClientRect().top;

                  return firstCharY === secondCharY;
                };

                if (
                  isRowTextNode(node) &&
                  firstClientRect &&
                  minh < firstClientRect.height * 2
                ) {
                  // 仅取第一行文本
                  targetBoundingBox.width = firstClientRect.width;
                  targetBoundingBox.height = firstClientRect.height;
                  targetBoundingBox.left = firstClientRect.left;
                  targetBoundingBox.top = firstClientRect.top;
                }

                commit({
                  ...result,
                  wid: `span${k}`,
                  ...targetBoundingBox,
                });

                node.replaceWith(textElement);
              }
            }
          }
        }
      },
      true
    );
  });

  for (let x = 0; x <= w; x += 10) {
    for (let y = start; y <= end; y += 5) {
      await page.mouse.move(x, y);
    }
  }

  const result =
    (await page.evaluate(() => {
      // @ts-ignore
      return window.__whats_element_result;
    })) || [];

  console.log(
    `url: ${url}, start: ${start}, end: ${end}, result.length: ${result.length}`
  );

  if (result.length === 0) {
    console.error("get result error", start, end);
  }

  // @ts-ignore
  result.forEach((re) => {
    re.left = re.left + dx;
    re.top = re.top + dy;
  });

  if (!debug) {
    await page.close();
  }

  return result ?? [];
};

const removeInvisibleElement = async (page: puppeteer.Page) => {
  await page.evaluate(() => {
    const removeElement = (element: Element) => {
      const style = getComputedStyle(element);

      const none = style.display === "none";
      const hidden = style.visibility === "hidden";
      const opacity = style.opacity === "0";
      const slider = Array.from(element.classList).some((v) =>
        v.includes("slider")
      );

      const boundingBox = element.getBoundingClientRect();
      const boundingBoxVisible =
        boundingBox.left + boundingBox.width > 0 &&
        boundingBox.top + boundingBox.height > 0 &&
        boundingBox.right > 0 &&
        boundingBox.bottom > 0;

      // 删除 link 标签会影响样式
      const isLink = element.tagName.toLowerCase() === "link";
      // 不要删除掉 slider
      if (
        (none || hidden || opacity || !boundingBoxVisible) &&
        !slider &&
        !isLink
      ) {
        element.parentNode?.removeChild(element);
      }

      if (element.children.length > 0) {
        Array.from(element.children).forEach((child) => {
          removeElement(child);
        });
      }
    };

    removeElement(document.body);
  });
};

main();
