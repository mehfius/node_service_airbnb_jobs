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

        const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);

        const scrapeApiHeaders = { 'Content-Type': 'application/json' };

        const { data: jobsData, error: jobsError } = await supabase.from('jobs').select('*').order('id', { ascending: false }).limit(1);

        if (jobsError) {
            console.error('Erro ao buscar a configuração do job:', jobsError.message);
            return;
        }

        const jobConfig = jobsData[0]; 
        if (!jobConfig) {
            console.warn('Nenhuma configuração de job encontrada. Verifique a tabela "jobs".');
            return;
        }

        const today = new Date(); 

        const { error: deleteError } = await supabase.from('history').delete().eq('job', jobConfig.id);
        if (deleteError) {
            console.error('Erro ao excluir histórico antigo:', deleteError.message);
        }

        for (let dayOffset = 0; dayOffset < jobConfig.days; dayOffset++) {
            const checkinDate = addDays(today, (1 + dayOffset)); 
            const checkoutDate = addDays(checkinDate, jobConfig.nights); 
            const checkinStr = format(checkinDate, 'yyyy-MM-dd'); 
            const checkoutStr = format(checkoutDate, 'yyyy-MM-dd'); 

            const airbnbUrlWithDates = `${jobConfig.url}${jobConfig.amenities.map(amenity => `&selected_filter_order%5B%5D=amenities%3A${amenity}`).join('')}${jobConfig.amenities.map(amenity => `&amenities%5B%5D=${amenity}`).join('')}&adults=${jobConfig.adults}&min_bedrooms=${jobConfig.min_bedrooms}&selected_filter_order%5B%5D=min_bedrooms%3A${jobConfig.min_bedrooms}&checkin=${checkinStr}&checkout=${checkoutStr}&price_max=${jobConfig.price_max}`;

            const pageScrapePromises = [];
            for (let pageNum = 0; pageNum < 2; pageNum++) {
                console.log(`Scraping data for : ${checkinStr} / ${checkoutStr}, Page: ${pageNum}`);
                const scrapePayload = {
                    page: pageNum,
                    airbnbUrl: airbnbUrlWithDates
                };

                pageScrapePromises.push(
                    fetch(jobConfig.scrape_url, {
                        method: 'POST',
                        headers: scrapeApiHeaders,
                        body: JSON.stringify(scrapePayload)
                    }).then(res => {
                        if (!res.ok) {
                            throw new Error(`Erro HTTP ao raspar página ${pageNum}: ${res.statusText}`);
                        }
                        return res.json();
                    })
                );
            }

            const allPageResponses = await Promise.allSettled(pageScrapePromises); 

            for (let i = 0; i < allPageResponses.length; i++) {
                const result = allPageResponses[i];
                if (result.status === 'fulfilled') {
                    const scrapeResponse = result.value;

                    const historyRecordsToInsert = scrapeResponse.data.map(item => ({
                        job: jobConfig.id,
                        room: item.room_id,
                        price: item.price,
                        position: item.position,
                        avaliables: item.avaliables,
                        checkin: checkinStr,
                        checkout: checkoutStr,
                        scrap_url: airbnbUrlWithDates
                    }));

                    if (historyRecordsToInsert.length > 0) {
                        const { error: insertError } = await supabase
                            .from("history")
                            .insert(historyRecordsToInsert);
                        console.log('Inserindo dados do histórico para página', i, 'com', historyRecordsToInsert.length, 'registros.');
                        if (insertError) {
                            console.error(`Erro ao inserir dados do histórico para página ${i}:`, insertError.message);
                        }
                    }
                } else {
                    console.error(`Falha ao raspar a página ${i}:`, result.reason);
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
