const createLanguageDropDown = require('./attach_dom/language_dropdown');
const BinarySocket           = require('../base/socket');
const isLoginPages           = require('../../_common/base/login').isLoginPages;
const getElementById         = require('../../_common/common_functions').getElementById;
const Crowdin                = require('../../_common/crowdin');
const Language               = require('../../_common/language');
const State                  = require('../../_common/storage').State;

const checkClientsCountry = () => {
    if (Crowdin.isInContext() || isLoginPages()) return;
    BinarySocket.wait('website_status', 'authorize').then(() => {
        const website_status = State.getResponse('website_status');
        if (!website_status) return;
        const clients_country = website_status.clients_country;
        if (clients_country === 'id') {
            limitLanguage('ID');
        } else {
            createLanguageDropDown(website_status);
        }
        State.set('is_eu', isEuropeanCountries(clients_country));
    });
};

const isEuropeanCountries = (country) => (/^(al|ad|at|by|be|ba|bg|hr|cy|cz|dk|ee|fo|fi|fr|de|gi|gr|hu|is|ie|im|it|ru|lv|li|lt|lu|mk|mt|md|mc|me|nl|no|pl|pt|ro|sm|sk|si|es|se|ch|ua|va)$/.test(country));

const limitLanguage = (lang) => {
    if (Language.get() !== lang) {
        window.location.href = Language.urlFor(lang); // need to redirect not using pjax
    }
    if (getElementById('select_language')) {
        $('.languages').remove();
        $('#gmt-clock').addClass('gr-6 gr-11-m').removeClass('gr-5 gr-6-m');
        $('#contact-us').addClass('gr-5').removeClass('gr-2');
    }
};

const checkLanguage = () => {
    if (Language.get() === 'ID') {
        const $academy_link = $('.academy a');
        const academy_href  = $academy_link.attr('href');
        const regex         = /id/;
        if (!regex.test(academy_href)) {
            $academy_link.attr('href', academy_href + regex);
        }
    }
};

module.exports = {
    checkClientsCountry,
    checkLanguage,
};
