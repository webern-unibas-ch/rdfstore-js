// Simple rdfstore-js test - just the basics
var rdfstore = require('../src/store');

console.log('\n🔧 E2E Test 1/4: Basic Integration');
console.log('================================');

rdfstore.create(function(err, store) {
    if (err) return console.error('❌ Failed:', err);
    
    console.log('✅ Store created');
    
    // Load simple data
    store.load('text/turtle', '<person:john> <foaf:name> "John Doe" .', function(err, count) {
        if (err) return console.error('❌ Load failed:', err);
        
        console.log(`✅ Loaded ${count} triple(s)`);
        
        // Simple query
        store.execute('SELECT * WHERE { ?s ?p ?o }', function(err, results) {
            if (err) return console.error('❌ Query failed:', err);
            
            console.log('✅ Query results:');
            results.forEach((result, i) => {
                console.log(`   ${i+1}. ${result.s.value} → ${result.p.value} → ${result.o.value}`);
            });
            
            store.close();
            promiseScenario();
        });
    });
});

// The same steps through the promise API
async function promiseScenario() {
    try {
        const store = await rdfstore.promises.create();
        console.log('✅ Store created (promises)');

        const count = await store.promises.load('text/turtle', '<person:jane> <foaf:name> "Jane Doe" .');
        console.log(`✅ Loaded ${count} triple(s) (promises)`);

        const results = await store.promises.execute('SELECT * WHERE { ?s ?p ?o }');
        if (results.length !== 1 || results[0].o.value !== 'Jane Doe') {
            throw new Error(`unexpected results: ${JSON.stringify(results)}`);
        }
        console.log(`✅ Query returned ${results.length} result(s) (promises)`);

        await store.promises.close();
        console.log('\n✅ Basic E2E test passed!\n');
    } catch (err) {
        console.error('❌ Promise API failed:', err);
        process.exitCode = 1;
    }
}
