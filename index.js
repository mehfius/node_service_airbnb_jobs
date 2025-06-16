// index.js
const dotenv = require('dotenv');
const { format, addDays } = require('date-fns');
const { createClient } = require('@supabase/supabase-js');

dotenv.config();

async function main() {
    const startTime = Date.now();
    try {
        const supabaseUrl = process.env.SUPABASE_URL;
        const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE;
        const scrapeUrl = process.env.SCRAPE_URL;

        const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);

        const scrapeApiHeaders = { 'Content-Type': 'application/json' };
  
        const { data: jobsData } = await supabase.from('jobs').select('*');
    
        const jobConfig = jobsData[0]; 

        const today = new Date();

        for (let dayOffset = 0; dayOffset < jobConfig.weekly_offset; dayOffset++) {
            const checkinDate = addDays(today, (1 + dayOffset));
            const checkoutDate = addDays(checkinDate, jobConfig.nights);

            const checkinStr = format(checkinDate, 'yyyy-MM-dd');
            const checkoutStr = format(checkoutDate, 'yyyy-MM-dd');

            const airbnbUrlWithDates = `${jobConfig.url}${jobConfig.amenities.map(amenity => `&selected_filter_order%5B%5D=amenities%3A${amenity}`).join('')}${jobConfig.amenities.map(amenity => `&amenities%5B%5D=${amenity}`).join('')}&adults=${jobConfig.adults}&guests=${jobConfig.adults}&min_bedrooms=${jobConfig.min_bedrooms}&selected_filter_order%5B%5D=min_bedrooms%3A${jobConfig.min_bedrooms}&checkin=${checkinStr}&checkout=${checkoutStr}`;
    
            
            for (let pageNum = 0; pageNum < 2; pageNum++) {
                console.log(`Scraping data for Check-in: ${checkinStr}, Check-out: ${checkoutStr}, Page: ${pageNum}`);

                const scrapePayload = {
                    page: pageNum,
                    airbnbUrl: airbnbUrlWithDates
                };

                const resScrape = await fetch(jobConfig.scrape_url, {
                    method: 'POST',
                    headers: scrapeApiHeaders,
                    body: JSON.stringify(scrapePayload)
                });

                const scrapeResponse = await resScrape.json();

                const historyRecordsToInsert = scrapeResponse.data.map(item => ({
                    job: jobConfig.id,
                    room_id: item.room_id,
                    price: item.price,
                    position: item.position,
                    checkin: checkinStr,
                    checkout: checkoutStr,
                    scrap_url: airbnbUrlWithDates
                }));

                if (historyRecordsToInsert.length > 0) {
                    await supabase
                        .from("history")
                        .insert(historyRecordsToInsert);
                }
            } 
        }
    } catch (error) {
        console.error('An error occurred:', error);
    }
    const endTime = Date.now();
    const durationInSeconds = (endTime - startTime) / 1000;
    console.log(`Job completed in ${durationInSeconds} seconds.`);
}

main();
