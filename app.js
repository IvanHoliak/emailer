#!/usr/bin/env node

import { Command } from "commander";
import Listr from "listr";
import axios from "axios";
import * as cheerio from "cheerio";
const params = {
    maxDepth: null,
    hrefOrigin: null,
    routes: [],
    result: [],
};

const commander = new Command();

commander
    .name("Email scrapper")
    .description("Script to get all emails on the site.")
    .version("1.0.0");

commander
    .option("-d, --depth <type>", "Maximum search depth", "3")
    .command("* <url>")
    .description("Site URL")
    .action(url => {
        const tasks = new Listr([
            {
                title: "Valid url",
                task: () => {
                    const isValid = urlIsValid(url);
                    if (!isValid) throw new Error();

                    params.hrefOrigin = new URL(url).origin;
                },
            },
            {
                title: "Process",
                task: async ctx => {
                    const result = await fetch(url);
                    if (!result) throw new Error();

                    const emails = result.reduce((acc, next) => {
                        if (next.emails.length) {
                            for (let i = 0; i < next.emails.length; i += 1) {
                                if (!acc.includes(next.emails[i]) && /^[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+$/.test(next.emails[i])) acc = [...acc, next.emails[i]];
                            }
                        }
                        return acc;
                    }, []);

                    ctx.emails = [...ctx.emails, ...emails];
                },
            },
        ]);

        tasks
            .run({
                emails: [],
            })
            .then(ctx => (ctx.emails.length ? ctx.emails.forEach(email => console.log(email)) : console.log("No emails!")))
            .catch(() => {
                console.error("ERROR");
            });
    });

commander.parse(process.argv);

const options = commander.opts();
params.maxDepth = +options.depth;

function urlIsValid(urlString) {
    try {
        return !!new URL(urlString);
    } catch (e) {
        return false;
    }
}

axios.interceptors.response.use(undefined, err => {
    const { config, message } = err;

    if (!config || !config.retry) {
        return Promise.reject(err);
    }

    if (!(message.includes("timeout") || message.includes("Network Error"))) {
        return Promise.reject(err);
    }

    config.retry -= 1;
    const delayRetryRequest = new Promise(resolve => {
        setTimeout(() => {
            // console.log("retry the request", config.url);
            resolve();
        }, config.retryDelay || 1000);
    });
    return delayRetryRequest.then(() => axios(config));
});

async function fetch(url, depth = 0) {
    try {
        if (depth > params.maxDepth) return params.result;

        const { data } = await axios.get(url, {
            retry: 3,
            retryDelay: 1000,
            timeout: 3000,
            headers: {
                "Accept-Encoding": "text/html", // application/json
            },
        });

        const parseResult = parser(data);

        params.result.push(parseResult);

        const originHref = new URL(url).origin;

        /*-------------------*/
        /* ----Promise all----*/
        /*-------------------*/
        // Быстро

        if (parseResult.routes.length) {
            const recResult = await recursive(parseResult.routes, depth, originHref);
            if (recResult) params.result.push(...recResult);
        }

        /*-------------------*/
        /* -------LOOP--------*/
        /*-------------------*/
        // Очень долго

        // if(parseResult.routes.length){
        //     for(let i = 0; i < parseResult.routes.length; i++){
        //         const recResult = urlIsValid(parseResult.routes[i])
        //         ? await fetch(parseResult.routes[i], depth + 1)
        //         : await fetch(`${params.hrefOrigin}${parseResult.routes[i]}`, depth + 1);
        //         if(recResult) result.push(...recResult);
        //     };
        // };

        return params.result;
    } catch (err) {
        return params.result;
        // console.log("Request error!", url, depth);
    }
}

async function recursive(routes, depth, origin) {
    return Promise.allSettled(routes.map(route => (urlIsValid(route) ? fetch(route, depth + 1) : fetch(`${origin}${route}`, depth + 1))))
        .then(() => {});
}

function parser(html) {
    const $ = cheerio.load(html);
    const allAnchers = $("body").find("a").map(function () {
        return $(this).attr("href") || "";
    }).get();

    return filterAnchors(allAnchers);
}

function filterAnchors(anch) {
    const filenameRegExp = /\.(jpe?g|png|gif|bmp|webp|pdf|mp[3-4])$/i;

    const cont = anch.reduce((acc, next) => {
        if (next.includes("mailto:")) acc.emails.push(next.substring(7));
        if (!next.includes("mailto:")
            && next !== "/"
            && !filenameRegExp.test(next)
            && !next.includes("/#")
            && !next.includes("#")
            && !next.includes("tel")) {
            if (acc.routes.length) {
                const isExist = acc.routes.some(route => route.replaceAll("/", "") === next.replaceAll("/", ""));
                next = /^\.?\.\//.test(next) ? next.replace(/^\.?\.\//, "/") : next;
                if (!isExist) acc.routes.push(next.trim());
            } else acc.routes.push(next.trim());
        }

        return acc;
    }, {
        routes: [],
        emails: [],
    });

    if (cont.routes.length) {
        cont.routes = cont.routes.filter(route => !params.routes.includes(route));
    }

    params.routes = [...new Set(...[params.routes.concat(cont.routes)])];

    return cont;
}
