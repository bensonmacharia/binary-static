const Client           = require('../../base/client');
const Header           = require('../../base/header');
const BinarySocket     = require('../../base/socket');
const isCryptocurrency = require('../../common/currency').isCryptocurrency;
const getElementById   = require('../../../_common/common_functions').getElementById;
const urlFor           = require('../../../_common/url').urlFor;
const getPropertyValue = require('../../../_common/utility').getPropertyValue;

const Cashier = (() => {
    let href = '';

    const showContent = () => {
        Client.activateByClientType();
        Header.upgradeMessageVisibility(); // To handle the upgrade buttons visibility
    };

    const displayTopUpButton = () => {
        BinarySocket.wait('balance').then((response) => {
            const balance   = +response.balance.balance;
            const can_topup = balance <= 1000;
            const top_up_id = '#VRT_topup_link';
            const $a        = $(top_up_id);
            if (!$a) {
                return;
            }
            const classes   = ['toggle', 'button-disabled'];
            const new_el    = { class: $a.attr('class').replace(classes[+can_topup], classes[1 - +can_topup]), html: $a.html(), id: $a.attr('id') };
            if (can_topup) {
                href        = href || urlFor('/cashier/top_up_virtualws');
                new_el.href = href;
            }
            $a.replaceWith($('<a/>', new_el));
            $(top_up_id).parent().setVisibility(1);
        });
    };

    const onLoad = () => {
        if (Client.isLoggedIn()) {
            BinarySocket.wait('authorize').then(() => {
                if (Client.get('is_virtual')) {
                    displayTopUpButton();
                }
                const residence = Client.get('residence');
                if (residence) {
                    BinarySocket.send({ paymentagent_list: residence }).then((response) => {
                        const list = getPropertyValue(response, ['paymentagent_list', 'list']);
                        if (list && list.length) {
                            $('#payment-agent-section').setVisibility(1);
                        }
                    });
                }
                $(isCryptocurrency(Client.get('currency')) ? '.crypto_currency' : '.normal_currency').setVisibility(1);
                if (/^BCH/.test(Client.get('currency'))) {
                    getElementById('message_bitcoin_cash').setVisibility(1);
                }
            });
        }
        showContent();
    };

    return {
        onLoad,
        PaymentMethods: { onLoad: () => { showContent(); } },
    };
})();

module.exports = Cashier;
