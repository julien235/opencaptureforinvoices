/** This file is part of Open-Capture for Invoices.

Open-Capture for Invoices is free software: you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

Open-Capture is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU General Public License for more details.

You should have received a copy of the GNU General Public License
along with Open-Capture for Invoices.  If not, see <https://www.gnu.org/licenses/>.

@dev : Nathan Cheval <nathan.cheval@outlook.fr> */

import { Component, OnInit } from '@angular/core';
import { DomSanitizer } from '@angular/platform-browser';
import { ActivatedRoute, Router } from "@angular/router";
import { API_URL } from "../../env";
import { catchError, map, startWith, tap } from "rxjs/operators";
import { Observable, of } from "rxjs";
import { HttpClient } from "@angular/common/http";
import { AuthService } from "../../../services/auth.service";
import { NotificationService } from "../../../services/notifications/notifications.service";
import { TranslateService } from "@ngx-translate/core";
import { marker } from "@biesbjerg/ngx-translate-extract-marker";
import { FormControl } from "@angular/forms";
import { DatePipe } from '@angular/common';
import { LocalStorageService } from "../../../services/local-storage.service";
import { ConfigService } from "../../../services/config.service";

declare var $: any;
import 'moment/locale/en-gb';
import 'moment/locale/fr';
import * as moment from 'moment';


@Component({
    selector: 'verifier-viewer',
    templateUrl: './verifier-viewer.component.html',
    styleUrls: ['./verifier-viewer.component.scss'],
    providers: [DatePipe]
})

export class VerifierViewerComponent implements OnInit {
    loading             : boolean   = true;
    isOCRRunning        : boolean   = false;
    settingsOpen        : boolean   = false;
    saveInfo            : boolean   = true;
    ocrFromUser         : boolean   = false;
    accountingPlanEmpty : boolean   = false;
    deleteDataOnChangeForm: boolean = true;
    imageInvoice        : any;
    imgSrc              : any;
    currentFilename     : string    = '';
    invoiceId           : any;
    invoice             : any;
    fields              : any;
    currentPage         : number    = 1;
    lastLabel           : string    = '';
    config              : any;
    lastId              : string    = '';
    lastColor           : string    = '';
    ratio               : number    = 0;
    fieldCategories     : any[]     = [
        {
            'id': 'supplier',
            'label': marker('FORMS.supplier')
        },
        {
            'id': 'facturation',
            'label': marker('FACTURATION.facturation')
        },
        {
            'id': 'other',
            'label': marker('FORMS.other')
        }
    ];
    disableOCR          : boolean   = false;
    form                : any       = {
        'supplier': [],
        'facturation': [],
        'other': []
    };
    formList            : any       = {};
    currentFormFields   : any       = {};
    pattern             : any       = {
        'alphanum': '^[0-9a-zA-Z\\s]*$',
        'alphanum_extended': '^[0-9a-zA-Z-/#\\s]*$',
        'number_int': '^[0-9]*$',
        'number_float': '^[0-9]*([.][0-9]*)*$',
        'char': '^[A-Za-z\\s]*$',
    };
    suppliers           : any       = [];
    filteredOptions     : Observable<any> | undefined;
    getOnlyRawFooter    : boolean   = false;
    toHighlight         : string    = '';
    supplierNamecontrol = new FormControl();
    toHighlightAccounting : string    = '';

    constructor(
        private router: Router,
        private http: HttpClient,
        private route: ActivatedRoute,
        private sanitizer: DomSanitizer,
        private authService: AuthService,
        public translate: TranslateService,
        private notify: NotificationService,
        private configService: ConfigService,
        private localeStorageService: LocalStorageService
    ) {}

    async ngOnInit(): Promise<void> {
        this.localeStorageService.save('splitter_or_verifier', 'verifier');
        this.ocrFromUser = false;
        this.saveInfo = true;
        this.config = this.configService.getConfig();
        this.invoiceId = this.route.snapshot.params['id'];
        this.invoice = await this.getInvoice();
        this.currentFilename = this.invoice.full_jpg_filename;
        await this.getThumb(this.invoice.full_jpg_filename);
        if (this.invoice.datas['form_id']) this.currentFormFields = await this.getFormById(this.invoice.datas['form_id']);
        if (Object.keys(this.currentFormFields).length === 0) this.currentFormFields = await this.getForm();
        this.formList = await this.getAllForm();
        this.formList = this.formList.forms;
        this.suppliers = await this.retrieveSuppliers();
        this.suppliers = this.suppliers.suppliers;
        /*
        * Enable library to draw rectangle on load (OCR ON FLY)
        */
        this.imageInvoice = $('#invoice_image');
        this.ratio = this.invoice.img_width / this.imageInvoice.width();
        this.ocr({
            'target' : {
                'id': '',
                'labels': [
                    {'textContent': ''}
                ]
            }
        }, true);
        if (this.invoice.supplier_id) this.getSupplierInfo(this.invoice.supplier_id, false, true);
        await this.fillForm(this.currentFormFields);
        setTimeout(() => {
            this.drawPositions();
            this.loading = false;
        }, 500);
        const triggerEvent = $('.trigger');
        triggerEvent.hide();
        this.filteredOptions = this.supplierNamecontrol.valueChanges
            .pipe(
                startWith(''),
                map(option => option ? this._filter(option) : this.suppliers.slice())
            );
    }

    async getThumb(filename:string) {
        this.http.post(API_URL + '/ws/verifier/getThumb',
            {'args': {'path': this.config['GLOBAL']['fullpath'], 'filename': filename}},
            {headers: this.authService.headers}).pipe(
            tap((data: any) => {
                this.imgSrc = this.sanitizer.bypassSecurityTrustUrl('data:image/jpeg;base64, ' + data.file);
            }),
            catchError((err: any) => {
                console.debug(err);
                this.notify.handleErrors(err);
                return of(false);
            })
        ).subscribe();
        return this.imgSrc;
    }

    private _filter(value: any): string[] {
        this.toHighlight = value;
        const filterValue = value.toLowerCase();
        return this.suppliers.filter((supplier: any) => supplier.name.toLowerCase().indexOf(filterValue) !== -1);
    }

    updateFilteredOption(event: any, control: any) {
        let value = '';
        if (event.target.value) value = event.target.value;
        else if (control.value) value = control.value;
        control.patchValue(value);
    }

    async drawPositions(): Promise<any> {
        for (const parent in this.fields) {
            for (const cpt in this.currentFormFields.fields[parent]) {
                const field = this.currentFormFields.fields[parent][cpt];
                const position = this.getPosition(field.id);
                const page = this.getPage(field.id);
                if (position && parseInt(String(page)) === parseInt(String(this.currentPage))) {
                    this.lastId = field.id;
                    this.lastLabel = this.translate.instant(field.label).trim();
                    this.lastColor = field.color;
                    this.disableOCR = true;
                    $('#' + field.id).focus();
                    const newArea = {
                        x: position.ocr_from_user ? position.x / this.ratio : position.x / this.ratio - ((position.x / this.ratio) * 0.1),
                        y: position.ocr_from_user ? position.y / this.ratio : position.y / this.ratio - ((position.y / this.ratio) * 0.02),
                        width: position.ocr_from_user ? position.width / this.ratio : position.width / this.ratio + ((position.width / this.ratio) * 0.05),
                        height: position.ocr_from_user ? position.height / this.ratio : position.height / this.ratio + ((position.height / this.ratio) * 0.5)
                    };
                    const triggerEvent = $('.trigger');
                    triggerEvent.hide();
                    triggerEvent.trigger('mousedown');
                    triggerEvent.trigger('mouseup', [newArea]);
                }
            }
        }
    }

    drawPositionByField(field: any, position: any) {
        this.lastId = field.id;
        this.lastLabel = this.translate.instant(field.label).trim();
        this.lastColor = field.color;
        this.disableOCR = true;
        $('#' + field.id).focus();
        const newArea = {
            x: position.x / this.ratio,
            y: position.y / this.ratio,
            width: position.width / this.ratio,
            height: position.height / this.ratio
        };
        const triggerEvent = $('.trigger');
        triggerEvent.hide();
        triggerEvent.trigger('mousedown');
        triggerEvent.trigger('mouseup', [newArea]);
    }

    getPosition(fieldId: any) {
        let position: any;
        if (this.invoice.positions) {
            Object.keys(this.invoice.positions).forEach((element: any) => {
                if (element === fieldId) {
                    position = this.invoice.positions[fieldId];
                }
            });
        }
        return position;
    }

    getPage(fieldId: any) {
        let page: number = 1;
        if (this.invoice.pages) {
            Object.keys(this.invoice.pages).forEach((element: any) => {
                if (element === fieldId) {
                    page = this.invoice.pages[fieldId];
                }
            });
        }
        return page;
    }

    async retrieveSuppliers(): Promise<any> {
        return await this.http.get(API_URL + '/ws/accounts/suppliers/list?order=name ASC', {headers: this.authService.headers}).toPromise();
    }

    async getInvoice(): Promise<any> {
        return await this.http.get(API_URL + '/ws/verifier/invoices/' + this.invoiceId, {headers: this.authService.headers}).toPromise();
    }

    async getForm(): Promise<any> {
        if (this.invoice.form_id)
            return await this.http.get(API_URL + '/ws/forms/fields/getByFormId/' + this.invoice.form_id, {headers: this.authService.headers}).toPromise();
        if (this.invoice.supplier_id)
            return await this.http.get(API_URL + '/ws/forms/fields/getBySupplierId/' + this.invoice.supplier_id, {headers: this.authService.headers}).toPromise();
        else
            return await this.http.get(API_URL + '/ws/forms/getDefault', {headers: this.authService.headers}).toPromise();
    }

    async getAllForm(): Promise<any> {
        return await this.http.get(API_URL + '/ws/forms/list', {headers: this.authService.headers}).toPromise();
    }

    async getFormById(formId: number): Promise<any> {
        return await this.http.get(API_URL + '/ws/forms/fields/getByFormId/' + formId, {headers: this.authService.headers}).toPromise();
    }

    async fillForm(data: any): Promise<any> {
        this.form = {
            'supplier': [],
            'facturation': [],
            'other': []
        };
        this.fields = data.fields;
        for (const category in this.fields) {
            for (const cpt in this.fields[category]) {
                const field = this.fields[category][cpt];
                this.form[category].push({
                    id: field.id,
                    label: field.label,
                    required: field.required,
                    control: new FormControl(),
                    type: field.type,
                    pattern: this.getPattern(field.format),
                    color: field.color,
                    unit: field.unit,
                    class: field.class,
                    format: field.format,
                    display: field.display,
                    format_icon: field.format_icon,
                    display_icon: field.display_icon,
                    class_label: field.class_label,
                    cpt: 0,
                    values: ''
                });

                if (field.id === 'accounting_plan') {
                    let array = await this.retrieveAccountingPlan();
                    this.accountingPlanEmpty = Object.keys(array).length === 0;
                    if (this.accountingPlanEmpty) {
                        array = await this.retrieveDefaultAccountingPlan();
                    }
                    array = this.sortArray(array);
                    this.form[category][cpt].values = this.form[category][cpt].control.valueChanges
                        .pipe(
                            startWith(''),
                            map(option => option ? this._filter_accounting(array, option) : array)
                        );
                }

                const _field = this.form[category][cpt];
                if (this.invoice.datas[field.id]) {
                    let value = this.invoice.datas[field.id];
                    if (field.format === 'date' && field.id !== '' && field.id !== undefined && value) {
                        value = value.replaceAll('.', '/');
                        value = value.replaceAll(',', '/');
                        value = value.replaceAll(' ', '/');
                        const format = moment().localeData().longDateFormat('L');
                        value = moment(value, format);
                        value = new Date(value._d);
                    }
                    _field.control.setValue(value);
                    _field.control.markAsTouched();
                }
                if (field.id === 'name' && category === 'supplier') this.supplierNamecontrol = this.form[category][cpt].control;
                this.findChildren(field.id, _field, category);
            }
        }
    }

    private _filter_accounting(array: any, value: any): string[] {
        this.toHighlightAccounting = value;
        const filterValue = value.toLowerCase();
        return array.filter((option: any) => option.compte_lib.toLowerCase().indexOf(filterValue) !== -1 || option.compte_num.toLowerCase().indexOf(filterValue) !== -1);
    }

    sortArray(array: any) {
        return array.sort((a: any, b: any) => {
            const x = a.compte_num, y = b.compte_num;
            return x === y ? 0 : x > y ? 1 : -1;
        });
    }

    async retrieveAccountingPlan() {
        return await this.http.get(API_URL + '/ws/accounts/customers/getAccountingPlan/' + this.invoice.customer_id, {headers: this.authService.headers}).toPromise();
    }

    async retrieveDefaultAccountingPlan() {
        return await this.http.get(API_URL + '/ws/accounts/customers/getDefaultAccountingPlan', {headers: this.authService.headers}).toPromise();
    }

    findChildren(parentId: any, parent: any, categoryId: any) {
        for (const field in this.invoice.datas) {
            if (field.includes(parentId + '_')) {
                parent.cpt += 1;
                const splitted = field.split('_');
                const cpt = parseInt(splitted[splitted.length - 1]) + 1;
                this.form[categoryId].push({
                    id: field,
                    label: parent.label,
                    required: parent.required,
                    control: new FormControl(),
                    type: parent.type,
                    pattern: this.getPattern(parent.format),
                    color: parent.color,
                    unit: parent.unit,
                    class: parent.class,
                    format: parent.format,
                    display: 'simple',
                    format_icon: parent.format_icon,
                    display_icon: parent.display_icon,
                    class_label: parent.class_label,
                    cpt: cpt,
                });
                const value = this.invoice.datas[field];
                const _field = this.form[categoryId][this.form[categoryId].length - 1];
                _field.control.setValue(value);
            }
        }
    }

    getSelectionByCpt(selection: any, cpt: any) {
        for (const index in selection) {
            if (selection[index].id === cpt)
                return selection[index];
        }
    }

    ocr(event: any, enable: boolean, color = 'green') {
        $('.trigger').show();
        const _this = this;
        this.lastId = event.target.id;
        this.lastLabel = event.target.labels[0].textContent.replace('*', '').trim();
        this.lastColor = color;
        const imageContainer = $('.image-container');
        const deleteArea = $('.delete-area');
        const backgroundArea = $('.select-areas-background-area');
        const resizeArea = $('.select-areas-resize-handler');
        deleteArea.addClass('pointer-events-auto');
        backgroundArea.addClass('pointer-events-auto');
        resizeArea.addClass('pointer-events-auto');
        imageContainer.addClass('pointer-events-none');
        imageContainer.addClass('cursor-auto');
        if (enable) {
            $('.outline_' + _this.lastId).toggleClass('animate');
            imageContainer.removeClass('pointer-events-none');
            imageContainer.removeClass('cursor-auto');
            this.imageInvoice.selectAreas({
                allowNudge: false,
                minSize: [20, 20],
                maxSize: [this.imageInvoice.width(), this.imageInvoice.height() / 8],
                onChanged(img: any, cpt: any, selection: any) {
                    if (selection.length !== 0 && selection['width'] !== 0 && selection['height'] !== 0) {
                        _this.ocr_process(img, cpt, selection);
                    }
                },
                onDeleted(img: any, cpt: any) {
                    const inputId = $('#select-area-label_' + cpt).attr('class').replace('input_', '').replace('select-none', '');
                    if (inputId) {
                        _this.updateFormValue(inputId, '');
                        if (_this.deleteDataOnChangeForm) {
                            _this.deleteData(inputId);
                            _this.deletePosition(inputId);
                            _this.deletePage(inputId);
                        }
                    }
                }
            });
        }else {
            let deleteClicked = false;
            $(".select-areas-delete-area").click(() => {
                deleteClicked = true;
            });
            setTimeout(() => {
                if (!deleteClicked) {
                    resizeArea.hide();
                    deleteArea.hide();
                }
            }, 200);
            $('.outline_' + _this.lastId).removeClass('animate');
        }
    }

    ocr_process(img: any, cpt: number, selection: any) {
        // Write the label of the input above the selection rectangle
        const page = this.getPage(this.lastId);
        if (this.ocrFromUser || (page === this.currentPage || page === 0)) {
            if ($('#select-area-label_' + cpt).length === 0) {
                const outline = $('#select-areas-outline_' + cpt);
                const backgroundArea = $('#select-areas-background-area_' + cpt);
                const labelContainer = $('#select-areas-label-container_' + cpt);
                labelContainer.append('<div id="select-area-label_' + cpt + '" class="input_' + this.lastId + ' select-none">' + this.lastLabel + '</div>');
                backgroundArea.css('background-color', this.lastColor);
                outline.addClass('outline_' + this.lastId);
                backgroundArea.addClass('background_' + this.lastId);
                backgroundArea.data('page', page);
                labelContainer.data('page', page);
                outline.data('page', page);
            }
            // End write

            const inputId = $('#select-area-label_' + cpt).attr('class').replace('input_', '').replace('select-none', '');
            $('#' + inputId).focus();

            // Test to avoid multi selection for same label. If same label exists, remove the selected areas and replace it by the new one
            const label = $('div[id*=select-area-label_]:contains(' + this.lastLabel + ')');
            const labelCount = label.length;
            if (labelCount > 1) {
                const cptToDelete = label[labelCount - 1].id.split('_')[1];
                $('#select-areas-label-container_' + cptToDelete).remove();
                $('#select-areas-background-area_' + cptToDelete).remove();
                $('#select-areas-outline_' + cptToDelete).remove();
                $('#select-areas-delete_' + cptToDelete).remove();
                $('.select-areas-resize-handler_' + cptToDelete).remove();
            }
            if (!this.isOCRRunning && !this.loading && this.saveInfo) {
                this.isOCRRunning = true;
                this.http.post(API_URL + '/ws/verifier/ocrOnFly',
                    {
                        selection: this.getSelectionByCpt(selection, cpt),
                        fileName: this.invoice.full_jpg_filename,
                        thumbSize: {width: img.currentTarget.width, height: img.currentTarget.height}
                    }, {headers: this.authService.headers})
                    .pipe(
                        tap((data: any) => {
                            this.updateFormValue(inputId, data.result);
                            this.isOCRRunning = false;
                            const res = this.saveData(data.result, this.lastId, true);
                            if (res) {
                                this.savePosition(this.getSelectionByCpt(selection, cpt));
                                this.savePages(this.currentPage).then();
                            }
                        }),
                        catchError((err: any) => {
                            console.debug(err);
                            this.notify.handleErrors(err);
                            return of(false);
                        })
                    ).subscribe();
            }
            this.saveInfo = true;
        }else {
            const input = $('.input_' + this.lastId);
            const background = $('.background_' + this.lastId);
            const outline = $('.outline_' + this.lastId);
            input.remove();
            background.remove();
            outline.remove();
        }
    }

    updateFormValue(inputId: string, value: any) {
        for (const category in this.form) {
            this.form[category].forEach((input: any) => {
                if (input.id.trim() === inputId.trim()) {
                    if (input.type === 'date') {
                        const format = moment().localeData().longDateFormat('L');
                        value = moment(value, format);
                        value = new Date(value._d);
                    }
                    input.control.setValue(value);
                    input.control.markAsTouched();
                }
            });
        }
    }

    savePosition(position: any) {
        position = {
            ocr_from_user: this.ocrFromUser,
            x: position.x * this.ratio,
            y: position.y * this.ratio,
            height: position.height * this.ratio,
            width: position.width * this.ratio
        };

        if (this.invoice.supplier_id) {
            this.http.put(API_URL + '/ws/accounts/supplier/' + this.invoice.supplier_id + '/updatePosition',
                {'args': {[this.lastId]: position}},
                {headers: this.authService.headers}).pipe(
                catchError((err: any) => {
                    console.debug(err);
                    this.notify.handleErrors(err);
                    return of(false);
                })
            ).subscribe();
        }

        this.http.put(API_URL + '/ws/verifier/invoices/' + this.invoice.id + '/updatePosition',
            {'args': {[this.lastId]: position}},
            {headers: this.authService.headers}).pipe(
                tap(() => {
                    this.invoice.positions[this.lastId] = position;
                }),
                catchError((err: any) => {
                    console.debug(err);
                    this.notify.handleErrors(err);
                    return of(false);
                })
        ).subscribe();
    }

    async savePages(page: any) {
        if (this.invoice.supplier_id) {
            this.http.put(API_URL + '/ws/accounts/supplier/' + this.invoice.supplier_id + '/updatePage',
                {'args': {[this.lastId]: page}},
                {headers: this.authService.headers}).pipe(
                catchError((err: any) => {
                    console.debug(err);
                    this.notify.handleErrors(err);
                    return of(false);
                })
            ).subscribe();
        }

        this.http.put(API_URL + '/ws/verifier/invoices/' + this.invoice.id + '/updatePage',
            {'args': {[this.lastId]: page}},
            {headers: this.authService.headers}).pipe(
                tap(() => {
                    this.invoice.pages[this.lastId] = page;
                }),
                catchError((err: any) => {
                    console.debug(err);
                    this.notify.handleErrors(err);
                    return of(false);
                })
        ).subscribe();
    }

    saveData(data: any, fieldId: any = false, showNotif: boolean = false) {
        if (data) {
            if (fieldId) {
                const field = this.getField(fieldId);
                if (field.control.errors || this.invoice.datas[fieldId] === data) return false;
                data = {[fieldId]: data};
            }
            this.http.put(API_URL + '/ws/verifier/invoices/' + this.invoice.id + '/updateData',
                {'args': data},
                {headers: this.authService.headers}).pipe(
                tap(() => {
                    this.invoice.datas[fieldId] = data;
                    if (showNotif) this.notify.success(this.translate.instant('INVOICES.position_and_data_updated', {"input": this.lastLabel}));
                }),
                catchError((err: any) => {
                    console.debug(err);
                    this.notify.handleErrors(err);
                    return of(false);
                })
            ).subscribe();
            return true;
        }
        return false;
    }

    updateInvoice(data: any) {
        this.http.put(API_URL + '/ws/verifier/invoices/' + this.invoiceId + '/update',
            {'args': data},
            {headers: this.authService.headers}).pipe(
            catchError((err: any) => {
                console.debug(err);
                this.notify.handleErrors(err);
                return of(false);
            })
        ).subscribe();
    }

    getField(fieldId: any) {
        let _field : any = {};
        for (const category in this.form) {
            this.form[category].forEach((field: any) => {
                if (field.id.trim() === fieldId.trim()) {
                    _field = field;
                }
            });
        }
        return _field;
    }

    deleteData(fieldId: any) {
        this.http.put(API_URL + '/ws/verifier/invoices/' + this.invoice.id + '/deleteData',
            {'args': fieldId.trim()},
            {headers: this.authService.headers}).pipe(
            tap(() => {
                this.notify.success(this.translate.instant('INVOICES.data_deleted', {"input": this.lastLabel}));
            }),
            catchError((err: any) => {
                console.debug(err);
                this.notify.handleErrors(err);
                return of(false);
            })
        ).subscribe();
    }

    deletePosition(fieldId: any) {
        this.http.put(API_URL + '/ws/verifier/invoices/' + this.invoice.id + '/deletePosition',
            {'args': fieldId.trim()},
            {headers: this.authService.headers}).pipe(
            catchError((err: any) => {
                console.debug(err);
                this.notify.handleErrors(err);
                return of(false);
            })
        ).subscribe();
    }

    deletePage(fieldId: any) {
        this.http.put(API_URL + '/ws/verifier/invoices/' + this.invoice.id + '/deletePage',
            {'args': fieldId.trim()},
            {headers: this.authService.headers}).pipe(
            catchError((err: any) => {
                console.debug(err);
                this.notify.handleErrors(err);
                return of(false);
            })
        ).subscribe();
    }

    getPattern(format: any) {
        let pattern = '';
        for (const cpt in this.pattern) {
            if (cpt === format) {
                pattern = this.pattern[cpt];
            }
        }
        return pattern;
    }

    duplicateField(fieldId: any, categoryId: any) {
        for (const category in this.form) {
            if (category === categoryId) {
                this.form[category].forEach((field: any, cpt:number) => {
                    if (field.id.trim() === fieldId.trim()) {
                        const newField = Object.assign({}, field);
                        newField.id = newField.id + '_' + field.cpt;
                        field.cpt += 1;
                        newField.cpt = field.cpt;
                        newField.display = 'simple';
                        newField.control.value = '';
                        this.form[category].splice(cpt + field.cpt, 0, newField);
                        this.saveData('', newField.id);
                        this.notify.success(this.translate.instant('INVOICES.field_duplicated', {"input": this.translate.instant(field.label)}));
                    }
                });
            }
        }
    }

    removeDuplicateField(fieldId: any, categoryId: any) {
        const parentId = fieldId.split('_').slice(0,-1).join('_');
        for (const category in this.form) {
            if (category === categoryId) {
                this.form[category].forEach((field: any, cpt:number) => {
                    if (field.id.trim() === fieldId.trim()) {
                        this.deleteData(field.id);
                        this.deletePosition(field.id);
                        this.form[category].splice(cpt, 1);
                    }else if (field.id.trim() === parentId.trim()) {
                        field.cpt = field.cpt - 1;
                    }
                });
            }
        }
    }

    isChildField(fieldId: any) {
        const splittedId = fieldId.split('_');
        return Number.isInteger(parseInt(splittedId[splittedId.length - 1]));
    }

    getSupplierInfo(supplierId: any, showNotif = false, launchOnInit = false) {
        this.suppliers.forEach((supplier: any) => {
            if (supplier.id === supplierId) {
                this.http.get(API_URL + '/ws/accounts/getAdressById/' + supplier.address_id, {headers: this.authService.headers}).pipe(
                    tap((address: any) => {
                        const supplierData : any = {
                            'name': supplier.name,
                            'address1': address.address1,
                            'address2': address.address2,
                            'city': address.city,
                            'country': address.country,
                            'postal_code': address.postal_code,
                            'siret': supplier.siret,
                            'siren': supplier.siren,
                            'vat_number': supplier.vat_number,
                        };
                        this.getOnlyRawFooter = supplier.get_only_raw_footer;
                        for (const column in supplierData) {
                            this.updateFormValue(column, supplierData[column]);
                        }

                        if (!launchOnInit) {
                            this.updateInvoice({'supplier_id': supplierId});
                            this.saveData(supplierData);
                            this.http.put(API_URL + '/ws/verifier/invoices/' + this.invoice.id + '/updateData',
                                {'args': supplierData},
                                {headers: this.authService.headers}).pipe(
                                tap(() => {
                                    this.invoice.supplier_id = supplierId;
                                    if (showNotif) {
                                        this.notify.success(this.translate.instant('INVOICES.supplier_infos_updated'));
                                    }
                                }),
                                catchError((err: any) => {
                                    console.debug(err);
                                    this.notify.handleErrors(err);
                                    return of(false);
                                })
                            ).subscribe();

                        }
                    }),
                    catchError((err: any) => {
                        console.debug(err);
                        this.notify.handleErrors(err);
                        return of(false);
                    })
                ).subscribe();
            }
        });
    }

    getErrorMessage(field: any, category: any) {
        let error: any;
        this.form[category].forEach((element: any) => {
            if (element.id === field) {
                if (element.control.errors) {
                    const required = element.control.errors.required;
                    const pattern = element.control.errors.pattern;
                    const datePickerPattern = element.control.errors.matDatepickerParse;
                    if (pattern) {
                        if (pattern.requiredPattern === this.getPattern('alphanum')) {
                            error = this.translate.instant('ERROR.alphanum_pattern');
                        }else if (pattern.requiredPattern === this.getPattern('alphanum_extended')) {
                            error = this.translate.instant('ERROR.alphanum_extended_pattern');
                        }else if (pattern.requiredPattern === this.getPattern('number_int')) {
                            error = this.translate.instant('ERROR.number_int_pattern');
                        }else if (pattern.requiredPattern === this.getPattern('number_float')) {
                            error = this.translate.instant('ERROR.number_float_pattern');
                        }
                    }else if (datePickerPattern) {
                        error = this.translate.instant('ERROR.date_pattern');
                    }else if (required) {
                        error = this.translate.instant('ERROR.field_required');
                    }else {
                        error = this.translate.instant('ERROR.unknow_error');
                    }
                }
            }
        });
        return error;
    }

    validateForm() {
        let valid = true;
        const arrayData: any = {};
        for (const category in this.form) {
            this.form[category].forEach((input: any) => {
                if (input.control.value) {
                    let value = input.control.value;
                    if (input.type === 'date') {
                        const format = moment().localeData().longDateFormat('L');
                        value = moment(value, format);
                        value = value.format(format);
                    }
                    Object.assign(arrayData, {[input.id] : value});
                }
                if (input.control.errors) {
                    valid = false;
                    this.notify.error(this.translate.instant('ERROR.form_not_valid'));
                }
            });
        }
        if (!valid) return;
        this.saveData(arrayData);
        const formId = this.currentFormFields.form_id;
        /*
            Executer les actions paramétrées dans les réglages du formulaires
         */
        this.http.get(API_URL + '/ws/forms/getById/' + formId, {headers: this.authService.headers}).pipe(
            tap((form: any) => {
                const outputsLabel: any[] = [];
                if (form.outputs.length !== 0) {
                    form.outputs.forEach((outputId: any, cpt: number) => {
                        this.http.get(API_URL + '/ws/outputs/getById/' + outputId, {headers: this.authService.headers}).pipe(
                            tap((data: any) => {
                                outputsLabel.push(data.output_label);
                                this.http.post(API_URL + '/ws/verifier/invoices/' + this.invoice.id + '/' + data.output_type_id, {'args': data.data},{headers: this.authService.headers}).pipe(
                                    tap(() => {
                                        /* Actions à effectuer après le traitement des chaînes sortantes */
                                        if (cpt + 1 === form.outputs.length) {
                                            this.updateInvoice({'status': 'END', 'locked': false, 'locked_by': null});
                                            this.router.navigate(['/verifier']).then();
                                            this.notify.success(this.translate.instant('VERIFIER.form_validated_and_output_done', {outputs: outputsLabel.join('<br>')}));
                                        }
                                    }),
                                    catchError((err: any) => {
                                        console.debug(err);
                                        this.notify.handleErrors(err);
                                        return of(false);
                                    })
                                ).subscribe();
                            }),
                            catchError((err: any) => {
                                console.debug(err);
                                this.notify.handleErrors(err);
                                return of(false);
                            })
                        ).subscribe();
                    });
                }else {
                    this.notify.error(this.translate.instant('VERIFIER.no_outputs_for_this_form', {'form': form.label}));
                }
            }),
            catchError((err: any) => {
                console.debug(err);
                this.notify.handleErrors(err);
                return of(false);
            })
        ).subscribe();
    }

    refuseForm() {
        console.log('here');
    }

    async changeForm(event: any) {
        this.loading = true;
        const newFormId = event.value;
        for (const cpt in this.formList) {
            if (this.formList[cpt].id === newFormId) {
                this.saveData({'form_id': newFormId});
                this.currentFormFields = await this.getFormById(newFormId);
                this.deleteDataOnChangeForm = false;
                this.imageInvoice.selectAreas('destroy');
                this.settingsOpen = false;
                this.notify.success(this.translate.instant('VERIFIER.form_changed'));
                await this.ngOnInit();
                this.deleteDataOnChangeForm = true;
            }
        }
    }

    nextPage() {
        if (this.currentPage < this.invoice.nb_pages) {
            this.currentPage = this.currentPage + 1;
            this.changeImage(this.currentPage, this.currentPage - 1);
        }else {
            this.changeImage(1, this.invoice.nb_pages);
        }
    }

    previousPage() {
        if (this.currentPage > 1) {
            this.currentPage = this.currentPage - 1;
            this.changeImage(this.currentPage, this.currentPage + 1);
        }else {
            this.changeImage(this.invoice.nb_pages, this.currentPage);
        }
    }

    changeImage(pageToShow: number, oldPage: number) {
        if (pageToShow) {
            const extension = this.currentFilename.split('.').pop();
            const oldCpt = ('000' + oldPage).substr(-3);
            const newCpt = ('000' + pageToShow).substr(-3);

            const newFilename = this.currentFilename.replace(oldCpt + '.' + extension, newCpt + '.' + extension);
            this.currentFilename = newFilename;
            this.getThumb(newFilename).then();
            this.currentPage = pageToShow;
            for (const parent in this.fields) {
                for (const cpt in this.currentFormFields.fields[parent]) {
                    const field = this.currentFormFields.fields[parent][cpt];
                    const position = this.getPosition(field.id);
                    const page = this.getPage(field.id);
                    if (position) {
                        const input = $('.input_' + field.id);
                        const background = $('.background_' + field.id);
                        const outline = $('.outline_' + field.id);
                        input.remove();
                        background.remove();
                        outline.remove();
                        this.saveInfo = false;
                        if (page === this.currentPage) this.drawPositionByField(field, position);
                    }
                }
            }
        }
    }
}
