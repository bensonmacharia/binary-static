import {
    action,
    observable }           from 'mobx';
import moment              from 'moment';
import BaseStore           from './base_store';
import { currentLanguage } from '../Utils/Language/index';

export default class CommonStore extends BaseStore {
    @observable server_time      = moment.utc();
    @observable current_language = currentLanguage;
    @observable has_error        = false;

    @observable error = {
        type   : 'info',
        message: '',
    };

    @action.bound
    setError(has_error, error) {
        this.has_error = has_error;
        this.error     = {
            type   : error ? error.type : 'info',
            message: error ? error.message : '',
        };
    }
}