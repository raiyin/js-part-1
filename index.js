let requestCounter = 0;

async function getData(url) {
    // https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API/Using_Fetch
    const response = await fetch(url, {
        method: 'GET',
        headers: {
            'Content-Type': 'application/json',
        },
        redirect: 'follow',
    }).then((response) => {
        if (!response.ok) {
            const err = new Error(`HTTP status code: ${response.status}`);
            err.response = response;
            err.status = response.status;
            throw err;
        }
        return response;
    });
    requestCounter += 1;
    return response.json();
}

async function loadCountriesData() {
    const countries = await getData('https://restcountries.com/v3.1/all?fields=name&fields=cca3&fields=area');
    return countries.reduce((result, country) => {
        result[country.cca3] = country;
        return result;
    }, {});
}

const baseUrl = 'https://restcountries.com/v3.1/alpha?fields=borders&fields=cca3&codes=';
const form = document.getElementById('form');
const fromCountry = document.getElementById('fromCountry');
const toCountry = document.getElementById('toCountry');
const countriesList = document.getElementById('countriesList');
const submit = document.getElementById('submit');
const output = document.getElementById('output');
let countriesData;
const codeByCountryDict = [];
let watchedCountries = new Set();
let graph = [];
let currentRoute = [];
let layerCounter = 0;

// По уже скачанному массиву данных создаёт строки маршрута методом поиска в глубину.
function CreateRoute(routes, to) {
    currentRoute = [];
    currentRoute.push(Object.keys(graph[0])[0]);
    go(0, graph[0][Object.keys(graph[0])[0]], to, routes);
}

function go(depth, currentNode, destCountry, routes) {
    const borders = graph[depth][currentNode.cca3].borders;
    for (let bIndex = 0; bIndex < borders.length; bIndex++) {
        // Если сосед текущего узла содержит страну назначения, то добаляем страну назначения
        // и сохраняем маршрут.
        if (borders[bIndex] === codeByCountryDict[destCountry]) {
            currentRoute.push(codeByCountryDict[destCountry]);
            routes.push(currentRoute.toString());
            currentRoute.pop();
            return;
        } else if (depth + 1 < layerCounter && graph[depth + 1][borders[bIndex]] !== undefined) {
            // Если не вышли за глубину графа и страна не была уже просмотрена на предыдущих уровнях.
            // Иначе делаем по очереди каждый узел текущим и "We need to go deeper".
            currentRoute.push(borders[bIndex]);
            go(depth + 1, graph[depth + 1][borders[bIndex]], destCountry, routes);
            currentRoute.pop();
        }
    }
}

function prettifyRoutes(routes) {
    let result = '';
    result += '<h3>';
    result += `Количество запросов: ${requestCounter}`;
    result += '</h3>';
    result += '<h4>Найденные маршруты:</h4>';
    result += '<ul>';
    for (let routeIndex = 0; routeIndex < routes.length; routeIndex++) {
        result += '<li>';
        result += routes[routeIndex]
            .split(',')
            // eslint-disable-next-line no-loop-func
            .map((item) => countriesData[item].name.common)
            .join('->');
        result += '</li>';
    }
    result += '</ul>';
    return result;
}

async function getCountriesByCodes(countriesCodeList) {
    const bordersResponse = [];
    try {
        const arrayFetchData = countriesCodeList.map((code) => getData(baseUrl + code));
        const data = await Promise.allSettled(arrayFetchData);
        data.forEach((item) => bordersResponse.push(item.value[0]));
        return bordersResponse;
    } catch (e) {
        console.log(e);
        return false;
    }
}

async function findPath(from, to) {
    // Метод работает по wave-подобному методу. Как только на какой-то глубине
    // находит необходимую страну, то более глубокие маршруты искать прекращает.
    layerCounter = 0;
    watchedCountries = new Set();
    graph = [];
    let scanQueue = [];
    currentRoute = [];
    const routes = [];
    let routeWasFind = false;
    requestCounter = 0;

    scanQueue.push(codeByCountryDict[from]);
    while (scanQueue.length > 0 && layerCounter < 10 && !routeWasFind) {
        // Скачиваем соседей.
        // 1) Был первый вариант рабочий. Использует 'codes', поэтому является незаконным,
        // так как по условию нужно тянуть страны по одной.
        // const countries = await getData(baseUrl + scanQueue);
        // 2)
        // Второй вариант. Эмулируем получение нескольких стран через получение одной.
        let countries = [];
        // eslint-disable-next-line no-loop-func, no-await-in-loop
        countries = await getCountriesByCodes(scanQueue);

        if (!Array.isArray(countries) || countries.includes(undefined)) {
            return `<h3>Ошибка выполнения запроса.<h3>`;
        }
        scanQueue = [];

        // Обновляем список просмотренных стран.
        // eslint-disable-next-line no-loop-func
        countries.forEach((country) => watchedCountries.add(country.cca3));
        const currentLayer = {};
        countries.forEach((country) => (currentLayer[country.cca3] = country));

        // Проходимся по текущему слою и заполняем его свойства.
        for (let cIndex = 0; cIndex < countries.length; cIndex++) {
            // Проверяем была ли среди соседей страна назначения.
            // При нахождении прекращаем искать.
            if (countries[cIndex].borders.includes(codeByCountryDict[to])) {
                routeWasFind = true;
                break;
            }

            // Одновременно создаем очередь для сканирования следующего слоя.
            // Перенёс сюда, чтобы не терять альтернативные маршруты, но и не плодить лишние запросы.
            for (let borderIndex = 0; borderIndex < countries[cIndex].borders.length; borderIndex++) {
                if (
                    !watchedCountries.has(countries[cIndex].borders[borderIndex]) &&
                    !scanQueue.includes(countries[cIndex].borders[borderIndex])
                ) {
                    scanQueue.push(countries[cIndex].borders[borderIndex]);
                }
            }
        }

        // Добавляем текущий слой.
        graph.push(currentLayer);
        layerCounter += 1;
    }

    if (routeWasFind) {
        CreateRoute(routes, to);
        return prettifyRoutes(routes);
    }

    return `<h3>Из ${from} в ${to} маршрута нет или маршрут больше 10.<h3>`;
}

// eslint-disable-next-line consistent-return
async function requestSubmit(event) {
    event.preventDefault();
    // TODO: Вывести, откуда и куда едем, и что идёт расчёт.
    // TODO: Рассчитать маршрут из одной страны в другую за минимум запросов.
    // TODO: Вывести маршрут и общее количество запросов.
    if (fromCountry.value.length === 0) {
        output.innerHTML = '<h3>Заполните, пожалуйста, поле страны отправления.</h3>';
        fromCountry.focus();
        return false;
    }
    if (toCountry.value.length === 0) {
        output.innerHTML = '<h3>Заполните, пожалуйста, поле страны назначения.</h3>';
        toCountry.focus();
        return false;
    }
    if (codeByCountryDict[fromCountry.value] == null) {
        output.innerHTML = '<h3>Указанной страны отправления не существует.</h3>';
        toCountry.focus();
        return false;
    }
    if (codeByCountryDict[toCountry.value] == null) {
        output.innerHTML = '<h3>Указанной страны назначения не существует.</h3>';
        toCountry.focus();
        return false;
    }
    if (fromCountry.value === toCountry.value) {
        output.innerHTML = '<h3>Страна отправления и страна назначения не должны совпадать.</h3>';
        toCountry.focus();
        return false;
    }

    disableUi(true);
    output.innerHTML = await findPath(fromCountry.value, toCountry.value);
    disableUi(false);
}

function disableUi(isDisabled) {
    fromCountry.disabled = isDisabled;
    toCountry.disabled = isDisabled;
    submit.disabled = isDisabled;
    if (isDisabled) {
        output.textContent = 'Loading…';
    }
}

(async () => {
    disableUi(true);
    // const countriesData = await loadCountriesData();
    countriesData = await loadCountriesData();
    output.textContent = '';

    // Заполняем список стран для подсказки в инпутах
    Object.keys(countriesData)
        .sort((a, b) => countriesData[b].area - countriesData[a].area)
        .forEach((code) => {
            const option = document.createElement('option');
            option.value = countriesData[code].name.common;
            countriesList.appendChild(option);
        });

    // Для удобства заполнем обратный справочник (страна-код).
    Object.keys(countriesData)
        .sort((a, b) => countriesData[b].area - countriesData[a].area)
        .forEach((code) => {
            codeByCountryDict[countriesData[code].name.common] = code;
        });

    disableUi(false);
    form.addEventListener('submit', requestSubmit);
})();
