export default {
    async fetch(request) {
      let url=new URL(request.url);
      url.hostname='target_host.com';
      let new_request=new Request(url, request);
      return fetch(new_request);
    }
};