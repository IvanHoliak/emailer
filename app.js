#!/usr/bin/env node

import { Command } from "commander";
import Listr from "listr";
import got from "got";
import * as cheerio from 'cheerio';

const params = {
    depth: 0,
    maxDepth: 3,
    was: [],
    hrefOrigin: null
};

const commander = new Command();

commander
    .name("Email scrapper")
    .description("Script to get all emails on the site.")
    .version("1.0.0");

commander
    .command("* <url>")
    .description("Site URL")
    .action((url) => {
        const tasks = new Listr([
            {
                title: "Valid url",
                task: () => {
                    const isValid = url_is_valid(url);
                    if(!isValid) throw new Error;

                    params.hrefOrigin = new URL(url).origin;
                }
            },
            {
                title: "Process",
                task: async(ctx) => {
                    const result = await request(url);
                    if(!result) throw new Error;

                    const emails = result.reduce((acc, next) => {
                        if(next.emails.length){
                            for(let i = 0; i < next.emails.length; i++){
                                if(!acc.includes(next.emails[i])) acc = [...acc, next.emails[i]];
                            };
                        };
                        return acc;
                    }, []);

                    ctx.emails = [...ctx.emails, ...emails];
                }
            },
        ]);

        tasks
            .run({
                emails: []
            })
            .then(ctx => ctx.emails.length ? ctx.emails.forEach(email => console.log(email)) : console.log("No emails!"))
            .catch(err => {
                console.error("ERROR");
            });
    });

commander.parse();

function url_is_valid(string){
    const pattern = new RegExp('^(https?:\\/\\/)?'+
    '((([a-z\\d]([a-z\\d-]*[a-z\\d])*)\\.)+[a-z]{2,}|'+
    '((\\d{1,3}\\.){3}\\d{1,3}))'+
    '(\\:\\d+)?(\\/[-a-z\\d%_.~+]*)*'+
    '(\\?[;&a-z\\d%_.~+=-]*)?'+
    '(\\#[-a-z\\d_]*)?$','i');

    return pattern.test(string);
};

async function request(url){
    try {
        if(params.was.includes(url)) return null;
        params.was.push(url);

        const result = [];
        
        const { body, statusCode } = await got.get(url);

        const parseResult = await parser(body);
        
        result.push(parseResult);

        if(params.depth < params.maxDepth && parseResult.routes.length) {
            params.depth += 1;
            for(let i = 0; i < parseResult.routes.length; i++){
                const depth = url_is_valid(parseResult.routes[i]) 
                    ? await request(parseResult.routes[i]) 
                    : await request(`${params.hrefOrigin}${parseResult.routes[i]}`);
                if(depth) result.push(...depth);
            };
        };
        return result;
    } catch(err) {
        // console.log("Request error!");
        // return new Error("Request error!");
    };
};

function parser(html){
    const $ = cheerio.load(html);
    const all_anchers = $("body").find("a").map(function(){
        const href = $(this).attr("href") || "";

        if(href) return href;
    }).get();

    return Promise.resolve(filterAnchors(all_anchers));
};

function filterAnchors(anch){
    const cont = anch.reduce((acc, next) => {
        if(next.includes("mailto:")) acc.emails.push(next.substring(7));
        if(!next.includes("mailto:") 
            && next !== "/" 
            && !next.includes("/#") 
            && !next.includes("#") 
            && !next.includes("tel")){
            if(acc.routes.length) {
                const isExist = acc.routes.some(route => route.replaceAll("/", "") === next.replaceAll("/", ""));
                if(!isExist) acc.routes.push(next)
            } else acc.routes.push(next);
        };

        return acc;
    }, {
        routes: [],
        emails: []
    });

    return cont;
};  