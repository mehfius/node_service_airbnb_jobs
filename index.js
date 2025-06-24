const dotenv = require('dotenv');
const { format, addDays } = require('date-fns');
const { createClient } = require('@supabase/supabase-js');

dotenv.config();

async function processJob(jobConfig, supabase) {
    const startTime = Date.now();

    console.log(`Iniciando processamento para o job ID: ${jobConfig.id}`);

    try {
        const scrapeApiHeaders = { 'Content-Type': 'application/json' };
        const today = new Date();

        const { error: deleteError } = await supabase.from('history').delete().eq('job', jobConfig.id);
        if (deleteError) {
            console.error(`Erro ao excluir histórico antigo para o job ${jobConfig.id}:`, deleteError.message);
        } else {
            console.log(`Histórico antigo para o job ${jobConfig.id} removido com sucesso.\n`);
        }

        for (let dayOffset = 0; dayOffset < jobConfig.days; dayOffset++) {
            const checkinDate = addDays(today, (1 + dayOffset));
            const checkoutDate = addDays(checkinDate, jobConfig.nights);
            const checkinStr = format(checkinDate, 'yyyy-MM-dd');
            const checkoutStr = format(checkoutDate, 'yyyy-MM-dd');

            const airbnbUrlWithDates = `${jobConfig.url}${jobConfig.amenities.map(amenity => `&selected_filter_order%5B%5D=amenities%3A${amenity}`).join('')}${jobConfig.amenities.map(amenity => `&amenities%5B%5D=${amenity}`).join('')}&adults=${jobConfig.adults}&min_bedrooms=${jobConfig.min_bedrooms}&selected_filter_order%5B%5D=min_bedrooms%3A${jobConfig.min_bedrooms}&checkin=${checkinStr}&checkout=${checkoutStr}&price_max=${jobConfig.price_max}`;

            const scrapingStartTime = Date.now();
            console.log(`Iniciando scraping para as datas: ${checkinStr} a ${checkoutStr}`);

            const pageScrapePromises = [];
            for (let pageNum = 0; pageNum < 4; pageNum++) {
                console.log(` - Disparando requisição para a Página: ${pageNum}`);
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
            const scrapingEndTime = Date.now();
            const scrapingDuration = (scrapingEndTime - scrapingStartTime) / 1000;
            console.log(`Requisições de scraping concluídas em ${scrapingDuration.toFixed(2)} segundos.\n`);

            for (let i = 0; i < allPageResponses.length; i++) {
                const result = allPageResponses[i];
                if (result.status === 'fulfilled') {
                    const scrapeResponse = result.value;

                    if (!scrapeResponse.data || scrapeResponse.data.length === 0) {
                        console.log(`   - Nenhum dado retornado do scraping para a página ${i}.`);
                        continue;
                    }

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
                        const insertionStartTime = Date.now();
                    
                        const { error: insertError } = await supabase
                            .from("history")
                            .insert(historyRecordsToInsert);
                        const insertionEndTime = Date.now();
                        const insertionDuration = (insertionEndTime - insertionStartTime) / 1000;
                        
                        if (insertError) {
                            console.error(`Erro ao inserir dados do histórico para página ${i}:`, insertError.message);
                        }
                    }
                } else {
                    console.error(`Falha ao raspar a página ${i}:`, result.reason);
                }
            }
        }
        
        // After all scraping and insertions for the job are done, query the count
        const { count, error: countError } = await supabase
            .from('history')
            .select('*', { count: 'exact' })
            .eq('job', jobConfig.id);

        if (countError) {
            console.error(`Erro ao contar registros na tabela history para o job ${jobConfig.id}:`, countError.message);
        } else {
            console.log(`Total de ${count} registros inseridos na tabela history para o job ${jobConfig.id}.`);

            // Update the 'jobs' table with the new 'qtd'
            const { error: updateError } = await supabase
                .from('jobs')
                .update({ qtd: count })
                .eq('id', jobConfig.id);

            if (updateError) {
                console.error(`Erro ao atualizar o campo 'qtd' para o job ${jobConfig.id}:`, updateError.message);
            } else {
                console.log(`Campo 'qtd' atualizado para ${count} no job ${jobConfig.id}.`);
            }
        }

    } catch (error) {
        console.error(`Ocorreu um erro inesperado no job ${jobConfig.id}:`, error);
    }

    const endTime = Date.now();
    const durationInSeconds = (endTime - startTime) / 1000;
    console.log(`Processamento do job ${jobConfig.id} concluído em ${durationInSeconds.toFixed(2)} segundos.`);
}

async function main() {
    try {
        const supabaseUrl = process.env.SUPABASE_URL;
        const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE;

        if (!supabaseUrl || !supabaseServiceRoleKey) {
            console.error("Variáveis de ambiente SUPABASE_URL e SUPABASE_SERVICE_ROLE são obrigatórias.");
            return;
        }

        const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);
        let channel = null; // Declare channel here to be accessible for re-subscription

        console.log("Serviço de scraping iniciado. Aguardando por novos jobs...");

        const connectToSupabaseRealtime = (retryCount = 0) => {
            if (channel) {
                channel.unsubscribe(); // Unsubscribe from previous channel to avoid duplicate listeners
                channel = null;
            }
            
            channel = supabase.channel('jobs-insert-listener');

            channel
                .on(
                    'postgres_changes',
                    {
                        event: 'INSERT',
                        schema: 'public',
                        table: 'jobs'
                    },
                    async (payload) => {
                        console.log('Novo job recebido!', `ID: ${payload.new.id}`);
                        await processJob(payload.new, supabase);
                    }
                )
                .subscribe((status, err) => {
                    if (status === 'SUBSCRIBED') {
                        console.log('Inscrito com sucesso no canal de jobs!');
                        retryCount = 0; // Reset retry count on successful subscription
                    } else if (status === 'CHANNEL_ERROR') {
                        console.error('Falha na inscrição do canal. Objeto de erro:', err);
                        console.error('Mensagem de erro:', err?.message || 'Erro desconhecido');
                        const delay = Math.min(1000 * Math.pow(2, retryCount), 30000); // Exponential back-off, max 30 seconds
                        console.warn(`Tentando reconectar em ${delay / 1000} segundos... Tentativa: ${retryCount + 1}`);
                        setTimeout(() => connectToSupabaseRealtime(retryCount + 1), delay);
                    } else if (status === 'TIMED_OUT') {
                        console.warn('Conexão com o canal expirou (timeout).');
                        const delay = Math.min(1000 * Math.pow(2, retryCount), 30000); // Exponential back-off, max 30 seconds
                        console.warn(`Tentando reconectar em ${delay / 1000} segundos... Tentativa: ${retryCount + 1}`);
                        setTimeout(() => connectToSupabaseRealtime(retryCount + 1), delay);
                    }
                });
        };

        connectToSupabaseRealtime(); // Initial connection attempt

    } catch (error) {
        console.error('Ocorreu um erro crítico ao iniciar o serviço:', error);
    }
}

main();