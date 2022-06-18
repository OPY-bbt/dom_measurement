import puppeteer from "puppeteer";
import fs from "fs";
import sizeOf from "buffer-image-size";

const whatElementScript = fs.readFileSync("./node_modules/whats-element/dist/whatsElement.js", "utf8");

(async () => {
  const browser = await puppeteer.launch({
    headless: false,
    // slowMo: 1000,
  });
  const page = await browser.newPage();

  // await page.goto("http://10.86.8.247:8080/example_page/");
  await page.goto("https://fund.eastmoney.com/");

  await page.waitForTimeout(10000);

  await page.screenshot({
    path: "example.png",
    fullPage: true,
    captureBeyondViewport: true,
  });

  const html = await page.$("html");

  // display:none 时为 null
  // const html_bounding_box = await html?.boundingBox();

  // const html_width = html_bounding_box?.width || 0;
  // const html_height = html_bounding_box?.height || 0;
  const dimensions = sizeOf(fs.readFileSync("example.png"));
  const html_width = dimensions.width;
  const html_height = dimensions.height;

  if (html_width === 0 || html_height === 0) {
    await browser.close();
    console.error("error: get html boundingBox");
    return;
  }

  console.log("html boundingBox", { html_width, html_height });

  await page.setViewport({ width: html_width, height: html_height });

  // 1. 在 html 范围内移动鼠标
  // 2. 触发 mousemove 事件时，给 event.target 增加唯一类名
  // 3. 对有标记的 dom 元素计算尺寸
  // 4. 保存元素尺寸和类型信息，一一对应，此处不需要保留原有 dom 树结构

  // 注入 whats-element
  // await page.evaluate(() => {
  //   const script = document.createElement("script");
  //   script.src = "../node_modules/whats-element/dist/whatsElement.js";
  //   document.head.appendChild(script);
  // });
  await page.addScriptTag({
    content: whatElementScript,
  });

  // 等待 whats-element 加载完成
  await page.waitForTimeout(3000);

  // 增加mousemove事件监听
  await page.evaluate(() => {
    // @ts-ignore
    const whats = new window.whatsElement({ draw: false });

    document.body.addEventListener(
      "mousemove",
      (event) => {
        if (event.target) {
          const result = whats.getUniqueId(event.target);
          if (event.target.getAttribute("data-whats-element-wid") === null) {
            event.target.setAttribute("data-whats-element-wid", result.wid);
            event.target.setAttribute("data-whats-element-type", result.type);

            event.target.style.color = "red";

            // @ts-ignore
            window.__whats_element_result
              ? window.__whats_element_result.push(result)
              : (window.__whats_element_result = [result]);
          }
        }
      },
      true
    );
  });

  for (let x = 0; x <= html_width; x += 1) {
    await page.mouse.move(x, 0);
    await page.mouse.move(x, html_height);
  }

  const result = await page.evaluate(() => {
    // @ts-ignore
    return window.__whats_element_result;
  });
  console.log(result.length);

  // await browser.close();
})();
