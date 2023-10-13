export default {
    async fetch(request) {
      let durl = request.url.split("/url/")[1];
      return fetch(decodeURI(durl));
    }
};
