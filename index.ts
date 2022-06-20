import puppeteer from "puppeteer";
import fs from "fs";
import sizeOf from "buffer-image-size";

const whatElementScript = fs.readFileSync("./node_modules/whats-element/dist/whatsElement.js", "utf8");
const fileName = "example";

const main = async () => {
  try {
    fs.unlinkSync(`${fileName}.json`);
  } catch(e) {}

  const browser = await puppeteer.launch({
    headless: false,
    // slowMo: 1000,
    args: ["--window-position=0,0"],
    devtools: true,
  });

  const url = "https://fund.eastmoney.com/";
  // const url = "https://bj.58.com/xinfang/";
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
  await page.waitForTimeout(10000);
  await page.screenshot({
    path: `${fileName}.png`,
    fullPage: true,
    captureBeyondViewport: true,
  });

  const gap = 1000;
  const count = Math.floor(html_height / gap);
  // const results = await Promise.all((new Array(count + 1).fill(0).map((_, idx) => {
  //   const increment = idx === count ? html_height % gap : gap;
  //   return createPage(browser, html_width, html_height, url, gap * idx, gap * idx + increment);
  // })));
  const result = await createPage(browser, html_width, html_height, url, 5000, 6000);
  const results = [result];

  const result_json = JSON.stringify(results.flat());
  fs.writeFileSync(`${fileName}.json`, result_json);

  // await browser.close();
}

const createPage = async (browser: puppeteer.Browser, w: number, h: number, url: string, start: number, end: number) => {
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

  await page.evaluate(() => {
    // @ts-ignore
    const whats = new window.whatsElement({ draw: false });

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

          let result;
          try {
            result = whats.getUniqueId(target);
          } catch(e) {
            target.id = "";
            result = whats.getUniqueId(target);
          }

          if (target.getAttribute("data-whats-element-wid") === null) {
            target.setAttribute("data-whats-element-wid", result.wid);
            target.setAttribute("data-whats-element-type", result.type);

            const boundingBox = target.getBoundingClientRect();
            result.width = boundingBox.width;
            result.height = boundingBox.height;

            target.style.color = "red";
            // target.style.backgroundColor = "red";

            // @ts-ignore
            window.__whats_element_result
              // @ts-ignore
              ? window.__whats_element_result.push(result)
              // @ts-ignore
              : (window.__whats_element_result = [result]);

            const display = getComputedStyle(target).display;
            if (display === "block" || display === "table-cell") {
              const nodeList = target.childNodes;
              for (let k = 0; k < nodeList.length; k++) {
                const node = nodeList[k];
                
                // 文字节点增加 span 标签
                if (node.nodeType === 3 && node.textContent?.trim() !== "") {
                  const text = node.textContent;
                  const textElement = document.createElement("span");
                  textElement.className = `span${k}`;
                  textElement.innerText = text ?? "";
                  textElement.style.display = "inline";
                  textElement.style.float = "none";
                  textElement.style.padding = "0";

                  textElement.setAttribute("data-whats-element-wid", `${result.wid}>.${textElement.className}`);
                  textElement.setAttribute("data-whats-element-type", result.type);

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
                  })
                }
              }  
            }
          }
        }
      },
      true
    );
  });

  for (let x = 0; x <= w; x += 15) {
    for ( let y = start; y <= end; y += 10) {
      await page.mouse.move(x, y);
    }
  }

  const result = await page.evaluate(() => {
    // @ts-ignore
    return window.__whats_element_result;
  }) || [];

  console.log(result.length);
  if (result.length === 0) {
    console.error("get result error", start, end);
  }

  return result ?? [];
};

main();
