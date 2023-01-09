let requestCounter = 0;
// Интересно знать изначальную причину ошибки, место появления
// и маршрут ее поднятия до верхнего обработчика. Стектрейс в стандартном
// объекте Error не стандартизирован, поэтому ввёл свой велосипед.
let myError = {
    status: '',
    stacktrace: '',
};

function printErrorMessage(error) {
    if (error.status && error.stacktrace) {
        console.error(error.status);
        console.error(error.stacktrace);
    } else {
        console.error(error);
    }
}

async function getDataAsync(url) {
    // https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API/Using_Fetch
    const response = await fetch(url, {
        method: 'GET',
        headers: {
            'Content-Type': 'application/json',
        },
        redirect: 'follow',
    });

    if (response.ok) {
        requestCounter += 1;
        return response.json();
    }

    myError.status = `Network response in getDataAsync was not OK, arg was ${url}, response was ${response}`;
    myError.stacktrace += `getDataAsync(${url})\n`;
    throw myError;
}

async function loadCountriesData() {
    let countries = [];
    try {
        // countries = await getDataAsync('http://httpstat.us/404/v3.1/all?fields=name&fields=cca3&fields=area');
        // countries = await getDataAsync('http://httpstat.us/500/v3.1/all?fields=name&fields=cca3&fields=area');
        countries = await getDataAsync('https://restcountries.com/v3.1/all?fields=name&fields=cca3&fields=area');
    } catch (error) {
        myError.status = error;
        myError.stacktrace += `loadCountriesData()\n`;
        throw myError;
    }
    return countries.reduce((result, country) => {
        result[country.cca3] = country;
        return result;
    }, {});
}

const baseUrl = 'https://restcountries.com/v3.1/alpha?fields=borders&fields=cca3&codes={code}';
// const baseUrl = 'http://httpstat.us/404&codes={code}';
// const baseUrl = 'http://httpstat.us/500&codes={code}';
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
function createRoute(routes, to) {
    currentRoute = [];
    const startCountry = Object.keys(graph[0])[0];
    currentRoute.push(startCountry);
    // Запукаем рекурсивную функцию для построения списка маршрутов.
    go(0, graph[0][startCountry], to, routes);
}

function go(depth, currentNode, destCountry, completeRoutes) {
    const borders = graph[depth][currentNode.cca3].borders;
    const destCountryCode = codeByCountryDict[destCountry];
    for (let bIndex = 0; bIndex < borders.length; bIndex++) {
        // Если сосед текущего узла содержит страну назначения, то добаляем страну назначения
        // и сохраняем маршрут.
        const currentNodeBorder = borders[bIndex];
        if (currentNodeBorder === destCountryCode) {
            currentRoute.push(destCountryCode);
            completeRoutes.push(currentRoute.map((x) => x));
            currentRoute.pop();
            return;
        } else if (depth + 1 < layerCounter && graph[depth + 1][currentNodeBorder] !== undefined) {
            // Если не вышли за глубину графа и страна не была уже просмотрена на предыдущих уровнях.
            // Иначе делаем по очереди каждый узел текущим и "We need to go deeper".
            currentRoute.push(currentNodeBorder);
            go(depth + 1, graph[depth + 1][currentNodeBorder], destCountry, completeRoutes);
            currentRoute.pop();
        }
    }
}

function prettifyOneRoute(routes, index) {
    let result = '<li>';
    result += routes[index].map((item) => countriesData[item].name.common).join('->');
    result += '</li>';
    return result;
}

function prettifyRoutes(routes) {
    let result = '';
    result += '<h3>';
    result += `Количество запросов: ${requestCounter}`;
    result += '</h3>';
    result += '<h4>Найденные маршруты:</h4>';
    result += '<ul>';
    for (let routeIndex = 0; routeIndex < routes.length; routeIndex++) {
        result += prettifyOneRoute(routes, routeIndex);
    }
    result += '</ul>';
    return result;
}

async function getCountriesByCodes(countriesCodeList) {
    const bordersResponse = [];
    try {
        const arrayFetchData = countriesCodeList.map((code) => getDataAsync(baseUrl.replace('{code}', code)));
        const data = await Promise.all(arrayFetchData);
        data.forEach((item) => bordersResponse.push(item[0]));
        return bordersResponse;
    } catch (error) {
        // Думал, что хорошей идеей будет получить хоть что-то, и потом искать в неполных данныз.
        // Но путём несложных логических
        // рассуждений пришёл к выводу, что в случае ошибки показывать пользователю сообщение
        // типа "Маршрут мы не нашли, но там ошибки были, так что мы не уверены, что его нет" не
        // очень хорошо. Лучше сразу говорить, что у нас была ошибка, повторите попытку.
        myError.status = error;
        myError.stacktrace += `getCountriesByCodes(${[...countriesCodeList]})\n`;
        throw myError;
    }
}

async function findPath(from, to) {
    // Метод работает по wave-подобному методу. Как только на какой-то глубине
    // находит необходимую страну, то более глубокие маршруты искать прекращает.
    layerCounter = 0;
    myError = {};
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
        // const countries = await getDataAsync(baseUrl + scanQueue);
        // 2)
        // Второй вариант. Эмулируем получение нескольких стран через получение одной.
        let countries = [];
        try {
            // eslint-disable-next-line no-await-in-loop
            countries = await getCountriesByCodes(scanQueue);
        } catch (error) {
            printErrorMessage(error);
            return `<h3>Ошибка при выполнении запроса.<h3>`;
        }

        scanQueue = [];

        // Обновляем список просмотренных стран.
        for (let countryIndex = 0; countryIndex < countries.length; countryIndex++) {
            watchedCountries.add(countries[countryIndex].cca3);
        }
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
        createRoute(routes, to);
        return prettifyRoutes(routes);
    }

    return `<h3>Из ${from} в ${to} маршрута нет или маршрут больше 10.<h3>`;
}

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
    return true;
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
    try {
        countriesData = await loadCountriesData();
    } catch (error) {
        printErrorMessage(error);
        output.textContent = 'Something went wrong. Try to reset your compluter.';
        // Интерфейс не разблочиваем. Ничего хорошего уже не получится.
        return;
    }
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
